import { createDefaultState, normalizeState } from './core.js';

const STATE_URL = '/api/state?v=final';
const SESSION_URL = '/api/session';
const LOCAL_STATE_KEY = 'poolside-pulse-vfinal-local-state';
const REQUEST_TIMEOUT_MS = 12_000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isJsonResponse(response) {
  return String(response.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

function localDevelopmentHost() {
  const location = globalThis.location;
  if (!location) return true;
  const hostname = String(location.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
}

function assertLocalFallbackAllowed(endpoint) {
  if (!localDevelopmentHost()) {
    const error = new Error(`${endpoint} is missing on this deployment. Poolside Pulse stopped instead of using an unsynchronized local copy.`);
    error.status = 503;
    throw error;
  }
}

function localRead() {
  try { return JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || 'null'); } catch { return null; }
}

function localWrite(state) {
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state)); } catch {}
}

async function responseData(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Cloud request timed out after 12 seconds.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function sessionStatus() {
  const response = await request(SESSION_URL, { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404 || !isJsonResponse(response)) {
    assertLocalFallbackAllowed('The session service');
    return { ok: true, authenticated: true, development: true };
  }
  return await responseData(response);
}

export async function loginSession(pin) {
  const response = await request(SESSION_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: String(pin || '').trim() })
  });
  return await responseData(response);
}

export async function logoutSession() {
  const response = await request(SESSION_URL, { method: 'DELETE', credentials: 'same-origin' });
  if (response.status === 404) return { ok: true };
  return await responseData(response);
}

export class CloudStore {
  constructor({ onState = () => {}, onStatus = () => {} } = {}) {
    this.state = normalizeState(localRead() || createDefaultState());
    this.onState = onState;
    this.onStatus = onStatus;
    this.syncMode = 'starting';
    this.cloudSync = false;
    this.pollTimer = null;
    this.pollInFlight = null;
    this.tail = Promise.resolve();
    this.lastError = '';
    this.serverOffsetMs = 0;
    this.fetchSequence = 0;
    this.appliedFetchSequence = 0;
  }

  now() {
    return Date.now() + this.serverOffsetMs;
  }

  durableReady() {
    return this.syncMode === 'kv' || (this.syncMode === 'local' && localDevelopmentHost());
  }

  observeServerTime(data, startedAt, finishedAt = Date.now()) {
    const serverTime = Number(data?.serverTime);
    if (!Number.isFinite(serverTime) || serverTime <= 0) return;
    this.serverOffsetMs = Math.round(serverTime - ((startedAt + finishedAt) / 2));
  }

  emit(reason = '') {
    localWrite(this.state);
    this.onState(clone(this.state), { reason, syncMode: this.syncMode, cloudSync: this.cloudSync });
  }

  status(message, ok = true) {
    this.lastError = ok ? '' : message;
    this.onStatus({ message, ok, syncMode: this.syncMode, cloudSync: this.cloudSync });
  }

  async fetchRemote() {
    const requestSequence = ++this.fetchSequence;
    const startedAt = Date.now();
    const response = await request(STATE_URL, { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 404 || !isJsonResponse(response)) {
      assertLocalFallbackAllowed('The cloud state service');
      if (requestSequence < this.appliedFetchSequence) return this.state;
      this.appliedFetchSequence = requestSequence;
      this.syncMode = 'local';
      this.cloudSync = false;
      this.state = normalizeState(localRead() || createDefaultState(this.now()), this.now());
      return this.state;
    }
    const data = await responseData(response);
    if (requestSequence < this.appliedFetchSequence) return this.state;
    this.appliedFetchSequence = requestSequence;
    this.observeServerTime(data, startedAt);
    this.syncMode = data.syncMode || 'cloud';
    this.cloudSync = !!data.cloudSync;
    const incoming = normalizeState(data.state == null ? createDefaultState(this.now()) : data.state, this.now());
    this.state = incoming;
    this.emit('cloud refresh');
    return this.state;
  }

  async postRemote(state, expectedRevision) {
    const safe = normalizeState(state, this.now());
    const startedAt = Date.now();
    const response = await request(STATE_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'final', expectedRevision, state: safe })
    });
    if (response.status === 404) {
      assertLocalFallbackAllowed('The cloud state service');
      this.syncMode = 'local';
      this.cloudSync = false;
      this.state = normalizeState({ ...safe, revision: expectedRevision + 1, savedAt: this.now() }, this.now());
      this.appliedFetchSequence = ++this.fetchSequence;
      this.emit('local save');
      return this.state;
    }
    let data;
    try {
      data = await responseData(response);
    } catch (error) {
      this.observeServerTime(error.data, startedAt);
      throw error;
    }
    this.observeServerTime(data, startedAt);
    this.syncMode = data.syncMode || 'cloud';
    this.cloudSync = !!data.cloudSync;
    this.state = normalizeState(data.state || safe, this.now());
    this.appliedFetchSequence = ++this.fetchSequence;
    this.emit('cloud save');
    return this.state;
  }

  async load() {
    try {
      const state = await this.fetchRemote();
      this.status(this.syncMode === 'kv' ? 'Cloud sync connected.' : this.syncMode === 'memory' ? 'Temporary server sync connected; durable KV is not active.' : 'Local development mode.', this.syncMode === 'kv' || this.syncMode === 'local');
      return state;
    } catch (error) {
      if (error.status === 401) throw error;
      this.syncMode = 'offline';
      this.cloudSync = false;
      this.state = normalizeState(localRead() || this.state);
      this.emit('offline fallback');
      this.status(`Cloud sync unavailable: ${error.message}. This device is using its local copy.`, false);
      return this.state;
    }
  }

  enqueue(work) {
    const job = this.tail.then(work, work);
    this.tail = job.catch(() => {});
    return job;
  }

  async mutate(mutator, reason = 'state update', { requireDurable = false } = {}) {
    return await this.enqueue(async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        let base;
        try {
          base = await this.fetchRemote();
        } catch (error) {
          if (error.status === 401 || requireDurable) throw error;
          base = this.state;
        }
        if (requireDurable && !this.durableReady()) {
          throw new Error('Durable KV cloud sync is required for receiver ownership and commands.');
        }
        const expectedRevision = Math.max(0, Number(base.revision || 0) || 0);
        const draft = clone(normalizeState(base, this.now()));
        const result = await mutator(draft);
        const next = normalizeState(result && typeof result === 'object' ? result : draft, this.now());
        try {
          const saved = await this.postRemote(next, expectedRevision);
          if (requireDurable && !this.durableReady()) {
            throw new Error('Durable KV cloud sync is required for receiver ownership and commands.');
          }
          if (!/^Receiver heartbeat/i.test(reason)) this.status(`${reason} saved.`, true);
          return saved;
        } catch (error) {
          if (error.status === 409) {
            if (Object.prototype.hasOwnProperty.call(error.data || {}, 'state')) {
              const conflictState = error.data.state == null ? createDefaultState(this.now()) : error.data.state;
              this.state = normalizeState(conflictState, this.now());
              this.appliedFetchSequence = ++this.fetchSequence;
              this.emit('conflict refresh');
            }
            if (attempt < 3) continue;
          }
          if (error.status === 401 || requireDurable) throw error;
          this.state = next;
          this.emit('offline mutation');
          if (!/^Receiver heartbeat/i.test(reason)) this.status(`${reason} saved locally; cloud sync failed: ${error.message}`, false);
          return next;
        }
      }
      throw new Error('State changed repeatedly while saving. Try again.');
    });
  }

  startPolling(intervalMs = 2500) {
    this.stopPolling();
    const poll = async () => {
      if (this.pollInFlight) return this.pollInFlight;
      this.pollInFlight = this.enqueue(async () => {
        try {
          await this.fetchRemote();
        } catch (error) {
          if (error.status === 401) {
            this.onStatus({ message: 'Session expired. Enter the access code again.', ok: false, authRequired: true });
          } else {
            this.status(`Sync retrying: ${error.message}`, false);
          }
        }
      }).finally(() => { this.pollInFlight = null; });
      return this.pollInFlight;
    };
    this.pollTimer = setInterval(poll, intervalMs);
    return poll();
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.pollInFlight = null;
  }
}
