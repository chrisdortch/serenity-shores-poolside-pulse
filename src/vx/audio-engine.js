import {
  DUCK_LEVEL_PERCENT,
  MUSIC_LEVEL_PERCENT,
  VOICE_LEVEL_PERCENT,
  clamp
} from './core.js';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const CALIBRATION_TIMEOUT_MS = 30_000;

function calibrationAbortError(reason = 'Sound check stopped.') {
  if (reason instanceof Error) return reason;
  const error = new Error(String(reason || 'Sound check stopped.'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw calibrationAbortError(signal.reason);
}

function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(calibrationAbortError(signal.reason));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => finish(reject, calibrationAbortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      value => finish(resolve, value),
      error => finish(reject, error)
    );
  });
}

function abortableWait(ms, signal) {
  if (!signal) return wait(ms);
  if (signal.aborted) return Promise.reject(calibrationAbortError(signal.reason));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(calibrationAbortError(signal.reason));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function waitFor(target, successEvent, errorEvent, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(successEvent, onSuccess);
      if (errorEvent) target.removeEventListener(errorEvent, onError);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onSuccess = () => finish(resolve, true);
    const onError = () => finish(reject, new Error(message));
    const timer = setTimeout(() => finish(reject, new Error(message)), timeoutMs);
    target.addEventListener(successEvent, onSuccess, { once: true });
    if (errorEvent) target.addEventListener(errorEvent, onError, { once: true });
  });
}

export function isIOSLike(userAgent = globalThis.navigator?.userAgent || '', platform = globalThis.navigator?.platform || '', maxTouchPoints = globalThis.navigator?.maxTouchPoints || 0) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && Number(maxTouchPoints) > 1);
}

function audioContextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function silentPrimeBlob() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount, true);
  bytes.fill(128, 44);
  return new Blob([bytes], { type: 'audio/wav' });
}

function analyzeBuffer(buffer) {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  const stride = Math.max(1, Math.floor(buffer.length / 250_000));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += stride) {
      const value = Math.abs(samples[i]);
      peak = Math.max(peak, value);
      sumSquares += value * value;
      count += 1;
    }
  }
  return { peak, rms: count ? Math.sqrt(sumSquares / count) : 0 };
}

function normalizedVoiceGain(buffer) {
  const { peak, rms } = analyzeBuffer(buffer);
  if (!peak || !rms) return 1;
  const peakLimited = 0.92 / peak;
  const rmsTargeted = 0.2 / rms;
  return clamp(Math.min(peakLimited, rmsTargeted), 0.75, 3.5, 1);
}

export function estimateDeviceSpeechTimeoutMs(text, rate = 0.94) {
  const message = String(text || '').trim();
  const safeRate = clamp(rate, 0.7, 1.2, 0.94);
  const words = message ? message.split(/\s+/).filter(Boolean).length : 0;
  const punctuationPauses = (message.match(/[,.!?;:]/g) || []).length * 180;
  const estimatedSpeechMs = (words * 60_000) / (155 * safeRate) + punctuationPauses;
  // Browser voices vary considerably. Allow roughly twice the normal speaking
  // estimate plus startup/ending slack, while still bounding a stuck utterance.
  return Math.round(clamp(estimatedSpeechMs * 2 + 3_000, 7_000, 90_000, 7_000));
}

export class AudioEngine {
  constructor({ onStatus = () => {}, onPlayback = () => {} } = {}) {
    this.onStatus = onStatus;
    this.onPlayback = onPlayback;
    this.context = null;
    this.musicBus = null;
    this.musicAnalyser = null;
    this.voiceBus = null;
    this.voiceInput = null;
    this.musicElement = null;
    this.musicElementSource = null;
    this.musicPrimed = false;
    this.musicPrimePromise = null;
    this.musicPrimeUrl = '';
    this.primingMusic = false;
    this.musicLevel = MUSIC_LEVEL_PERCENT / 100;
    this.duckLevel = DUCK_LEVEL_PERCENT / 100;
    this.voiceLevel = VOICE_LEVEL_PERCENT / 100;
    this.unlocked = false;
    this.currentLabel = '';
    this.currentUrl = '';
    this.currentRunToken = '';
    this.currentTrackIndex = 0;
    this.builtInBed = null;
    this.voiceSource = null;
    this.voiceCancel = null;
    this.speechCancel = null;
    this.announcementDepth = 0;
    this.musicRamp = null;
    this.calibrationActive = false;
    this.calibrationController = null;
    this.calibrationPromise = null;
  }

  status() {
    return {
      supported: !!audioContextConstructor(),
      unlocked: this.isOperational(),
      contextState: this.context?.state || 'not-created',
      musicLevelPercent: Math.round(this.musicLevel * 100),
      voiceLevelPercent: Math.round(this.voiceLevel * 100),
      duckLevelPercent: Math.round(this.duckLevel * 100),
      musicPlaying: this.musicPlaying(),
      calibrationActive: this.calibrationActive,
      label: this.currentLabel,
      url: this.currentUrl,
      scheduledRunToken: this.currentRunToken
    };
  }

  isOperational() {
    return this.unlocked && this.context?.state === 'running';
  }

  report(message, ok = true) {
    this.onStatus({ message, ok, ...this.status() });
  }

  ensureGraph() {
    if (this.context) return this.context;
    const AudioContext = audioContextConstructor();
    if (!AudioContext) throw new Error('This browser does not provide Web Audio. Use a current Safari, Chrome, Edge, or Firefox browser.');
    const context = new AudioContext({ latencyHint: 'playback' });
    const musicBus = context.createGain();
    const musicAnalyser = context.createAnalyser();
    musicAnalyser.fftSize = 1024;
    musicAnalyser.smoothingTimeConstant = 0.2;
    const musicLimiter = context.createDynamicsCompressor();
    musicLimiter.threshold.value = -1.5;
    musicLimiter.knee.value = 0;
    musicLimiter.ratio.value = 20;
    musicLimiter.attack.value = 0.003;
    musicLimiter.release.value = 0.18;
    musicBus.gain.value = this.musicLevel;
    // Keep the signal verifier ahead of the adjustable music gain. At a valid
    // 0% target the destination must be silent, but source PCM still needs to
    // be distinguishable from a stalled, silent, or CORS-blocked media source.
    musicBus.connect(musicLimiter).connect(context.destination);

    const voiceInput = context.createGain();
    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 90;
    highPass.Q.value = 0.7;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2800;
    presence.Q.value = 0.85;
    presence.gain.value = 2.2;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const voiceBus = context.createGain();
    voiceBus.gain.value = this.voiceLevel;
    voiceInput.connect(highPass).connect(presence).connect(compressor).connect(limiter).connect(voiceBus).connect(context.destination);

    this.context = context;
    this.musicBus = musicBus;
    this.musicRamp = null;
    this.musicAnalyser = musicAnalyser;
    this.voiceInput = voiceInput;
    this.voiceBus = voiceBus;
    return context;
  }

  async unlock({ audibleTest = false } = {}) {
    const context = this.ensureGraph();
    // Start the real HTMLMediaElement inside the receiver tap call stack. This
    // preserves the user-activation grant Safari/iOS requires when a scheduled
    // track is loaded later, while sending only silent PCM through the current
    // music bus target.
    const mediaPrime = this.primeMusicElement();
    const contextResume = context.state === 'running'
      ? Promise.resolve(true)
      : withTimeout(
          context.resume(),
          5_000,
          'Receiver audio did not start. Keep this page visible, check the browser sound permission, and tap Start Receiver again.'
        );
    try {
      await Promise.all([contextResume, mediaPrime]);
      if (context.state !== 'running') throw new Error(`Receiver audio is ${context.state}. Tap Start Receiver again while this page is visible.`);
      this.unlocked = true;
      if (audibleTest) await this.playUnlockTone();
      this.report(`Receiver mixer ready: music is set to ${Math.round(this.musicLevel * 100)}% and announcements to ${Math.round(this.voiceLevel * 100)}%.`, true);
      return true;
    } catch (error) {
      this.unlocked = false;
      throw error;
    }
  }

  async playUnlockTone() {
    const context = this.ensureGraph();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    oscillator.connect(gain).connect(this.voiceInput);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
    await wait(340);
  }

  getMusicElement() {
    if (this.musicElement) return this.musicElement;
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10000px;top:-10000px;';
    document.body.appendChild(audio);
    this.musicElement = audio;
    const context = this.ensureGraph();
    this.musicElementSource = context.createMediaElementSource(audio);
    this.musicElementSource.connect(this.musicAnalyser).connect(this.musicBus);
    audio.addEventListener('playing', () => {
      if (!this.primingMusic) this.onPlayback({ type: 'playing', label: this.currentLabel, url: this.currentUrl, scheduledRunToken: this.currentRunToken });
    });
    audio.addEventListener('pause', () => {
      if (!this.primingMusic) this.onPlayback({ type: 'paused', label: this.currentLabel, url: this.currentUrl, scheduledRunToken: this.currentRunToken });
    });
    audio.addEventListener('ended', () => this.onPlayback({ type: 'ended', label: this.currentLabel, url: this.currentUrl, scheduledRunToken: this.currentRunToken }));
    audio.addEventListener('error', () => this.onPlayback({ type: 'error', label: this.currentLabel, url: this.currentUrl, scheduledRunToken: this.currentRunToken, error: audio.error?.message || 'Audio media error' }));
    return audio;
  }

  primeMusicElement() {
    if (this.musicPrimed) return Promise.resolve(true);
    if (this.musicPrimePromise) return this.musicPrimePromise;
    const audio = this.getMusicElement();
    if (this.currentUrl && audio.src) {
      this.musicPrimed = true;
      return Promise.resolve(true);
    }
    this.primingMusic = true;
    this.musicPrimeUrl = URL.createObjectURL(silentPrimeBlob());
    audio.src = this.musicPrimeUrl;
    audio.loop = false;
    audio.muted = false;
    audio.volume = 1;
    audio.load();
    let playResult;
    try {
      playResult = audio.play();
    } catch (error) {
      this.primingMusic = false;
      throw error;
    }
    this.musicPrimePromise = withTimeout(
      Promise.resolve(playResult),
      5_000,
      'The browser did not unlock scheduled music. Keep this page visible and tap Start Receiver again.'
    ).then(() => {
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      this.musicPrimed = true;
      return true;
    }).finally(() => {
      this.primingMusic = false;
      this.musicPrimePromise = null;
    });
    return this.musicPrimePromise;
  }

  releaseMusicPrime() {
    if (!this.musicPrimeUrl) return;
    try { URL.revokeObjectURL(this.musicPrimeUrl); } catch {}
    this.musicPrimeUrl = '';
  }

  setMusicBus(level, rampMs = 180) {
    const context = this.ensureGraph();
    const target = clamp(level, 0, 1, this.musicLevel);
    const now = context.currentTime;
    const gain = this.musicBus.gain;
    const previousRamp = this.musicRamp;
    let heldValue = Number(gain.value);
    if (previousRamp) {
      if (now <= previousRamp.startTime) {
        heldValue = previousRamp.startValue;
      } else if (now >= previousRamp.endTime) {
        heldValue = previousRamp.targetValue;
      } else {
        const progress = (now - previousRamp.startTime) / (previousRamp.endTime - previousRamp.startTime);
        heldValue = previousRamp.startValue + (previousRamp.targetValue - previousRamp.startValue) * progress;
      }
    }
    heldValue = clamp(heldValue, 0, 1, target);

    let heldNatively = false;
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      try {
        gain.cancelAndHoldAtTime(now);
        heldNatively = true;
      } catch {}
    }
    if (!heldNatively) {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(heldValue, now);
    }

    const endTime = now + Math.max(0.01, rampMs / 1000);
    gain.linearRampToValueAtTime(target, endTime);
    this.musicRamp = { startValue: heldValue, targetValue: target, startTime: now, endTime };
  }

  setMusicLevelPercent(percent, { rampMs = 140, report = true } = {}) {
    const targetPercent = clamp(percent, 0, 100, MUSIC_LEVEL_PERCENT);
    this.musicLevel = targetPercent / 100;
    this.duckLevel = Math.min(DUCK_LEVEL_PERCENT, targetPercent) / 100;
    if (this.musicBus) {
      const audibleTarget = this.announcementDepth > 0 ? this.duckLevel : this.musicLevel;
      this.setMusicBus(audibleTarget, rampMs);
    }
    if (report) this.report(`Music target set to ${targetPercent}%. Announcements are set to ${Math.round(this.voiceLevel * 100)}%.`, true);
    return targetPercent;
  }

  setVoiceLevelPercent(percent, { rampMs = 80, report = true } = {}) {
    const targetPercent = clamp(percent, 0, 100, VOICE_LEVEL_PERCENT);
    this.voiceLevel = targetPercent / 100;
    if (this.voiceBus && this.context) {
      const now = this.context.currentTime;
      const gain = this.voiceBus.gain;
      let held = clamp(gain.value, 0, 1, this.voiceLevel);
      if (typeof gain.cancelAndHoldAtTime === 'function') {
        try {
          gain.cancelAndHoldAtTime(now);
          held = clamp(gain.value, 0, 1, this.voiceLevel);
        } catch {
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(held, now);
        }
      } else {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(held, now);
      }
      gain.linearRampToValueAtTime(this.voiceLevel, now + Math.max(0.01, rampMs / 1000));
    }
    if (report) this.report(`Announcement target set to ${targetPercent}%.`, true);
    return targetPercent;
  }

  async verifyMusicSignal(timeoutMs = 4_000) {
    if (!this.musicAnalyser) return false;
    const samples = new Float32Array(this.musicAnalyser.fftSize);
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      this.musicAnalyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
      if (peak > 0.00001) return true;
      await wait(120);
    }
    return false;
  }

  async playMusicUrl(url, { label = 'Suno / direct audio', loop = false, startAt = 0, scheduledRunToken = '' } = {}) {
    if (!this.isOperational()) throw new Error('Start Receiver before playing music.');
    const raw = String(url || '').trim();
    if (!/^https:\/\//i.test(raw)) throw new Error('Music needs a secure HTTPS Suno or direct audio URL.');
    this.stopBuiltInBed();
    const audio = this.getMusicElement();
    const changed = audio.src !== raw;
    if (changed) {
      audio.pause();
      this.releaseMusicPrime();
      audio.src = raw;
      audio.load();
    }
    audio.loop = !!loop;
    audio.muted = false;
    audio.volume = 1;
    this.currentUrl = raw;
    this.currentLabel = String(label || 'Suno / direct audio');
    this.currentRunToken = String(scheduledRunToken || '');
    this.setMusicBus(this.announcementDepth > 0 ? this.duckLevel : this.musicLevel, 80);
    if (!changed && !audio.paused && !audio.ended) {
      this.report(`${this.currentLabel} is already playing through the exact ${Math.round(this.musicLevel * 100)}% music bus.`, true);
      return true;
    }
    if (startAt > 0) {
      if (changed || audio.readyState < 1) {
        await waitFor(audio, 'loadedmetadata', 'error', 12_000, 'The music URL did not load. Confirm that it is public and supports browser playback.');
      }
      audio.currentTime = Math.min(Number(startAt) || 0, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : Number(startAt) || 0);
    }
    await withTimeout(
      Promise.resolve(audio.play()),
      12_000,
      'The music URL could not start through the calibrated mixer. Use a public Suno or CORS-enabled direct audio URL.'
    );
    if (!await this.verifyMusicSignal()) {
      audio.pause();
      throw new Error('The track started, but no audio entered the calibrated mixer. Use a public Suno link or a direct audio host that permits browser audio (CORS).');
    }
    this.report(`${this.currentLabel} is playing through the exact ${Math.round(this.musicLevel * 100)}% music bus.`, true);
    return true;
  }

  musicPlaying() {
    if (!this.isOperational()) return false;
    return !!this.builtInBed || (!!this.musicElement && !this.musicElement.paused && !this.musicElement.ended);
  }

  pauseMusic() {
    let changed = false;
    if (this.musicElement && !this.musicElement.paused) {
      this.musicElement.pause();
      changed = true;
    }
    if (this.builtInBed) {
      this.builtInBed.stop();
      this.builtInBed = null;
      changed = true;
    }
    if (changed) this.report('Music paused.', true);
    return changed;
  }

  async resumeMusic() {
    if (!this.currentUrl || !this.musicElement?.src || this.musicElement.src === this.musicPrimeUrl) return false;
    const context = this.ensureGraph();
    if (context.state !== 'running') {
      await withTimeout(context.resume(), 5_000, 'The receiver mixer did not resume. Keep this page visible and tap Start Receiver again.');
    }
    if (context.state !== 'running') throw new Error(`Receiver audio is ${context.state}; music stayed paused.`);
    this.setMusicBus(this.announcementDepth > 0 ? this.duckLevel : this.musicLevel, 120);
    await withTimeout(Promise.resolve(this.musicElement.play()), 12_000, 'The paused track could not resume through the calibrated mixer.');
    if (!await this.verifyMusicSignal()) {
      this.musicElement.pause();
      throw new Error('The track resumed, but no audio entered the calibrated mixer. Music was paused instead of reporting a false playing state.');
    }
    this.report(`${this.currentLabel || 'Music'} resumed at ${Math.round(this.musicLevel * 100)}%.`, true);
    return true;
  }

  stopMusic() {
    const changed = this.pauseMusic();
    if (this.musicElement) {
      try { this.musicElement.currentTime = 0; } catch {}
    }
    this.currentLabel = '';
    this.currentUrl = '';
    this.currentRunToken = '';
    this.report('Music stopped.', true);
    return changed;
  }

  playBuiltInBed({ label = 'Receiver calibration bed' } = {}) {
    if (!this.isOperational()) throw new Error('Start Receiver before playing the calibration bed.');
    this.stopMusic();
    const context = this.ensureGraph();
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(this.musicBus);
    const frequencies = [196, 246.94, 293.66, 392];
    const oscillators = frequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index < 2 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.value = index < 2 ? 0.11 : 0.035;
      oscillator.connect(gain).connect(master);
      oscillator.start();
      return { oscillator, gain };
    });
    let stopped = false;
    const playback = {
      stop: () => {
        if (stopped) return false;
        stopped = true;
        oscillators.forEach(({ oscillator, gain }) => {
          try { oscillator.stop(); } catch {}
          try { oscillator.disconnect(); gain.disconnect(); } catch {}
        });
        try { master.disconnect(); } catch {}
        return true;
      }
    };
    this.builtInBed = playback;
    this.currentLabel = label;
    this.currentUrl = 'poolside://calibration-bed';
    this.currentRunToken = '';
    this.setMusicBus(this.announcementDepth > 0 ? this.duckLevel : this.musicLevel, 120);
    this.report(`${label} is playing through the exact ${Math.round(this.musicLevel * 100)}% music bus.`, true);
    return true;
  }

  stopBuiltInBed() {
    if (!this.builtInBed) return false;
    const playback = this.builtInBed;
    this.builtInBed = null;
    try { playback.stop(); } catch {}
    if (this.currentUrl === 'poolside://calibration-bed') {
      this.currentLabel = '';
      this.currentUrl = '';
    }
    return true;
  }

  async beginAnnouncement({ signal = null } = {}) {
    throwIfAborted(signal);
    this.announcementDepth += 1;
    if (this.announcementDepth > 1) return;
    this.setMusicBus(this.duckLevel, 320);
    await abortableWait(380, signal);
  }

  async endAnnouncement({ restore = true, signal = null } = {}) {
    this.announcementDepth = Math.max(0, this.announcementDepth - 1);
    if (this.announcementDepth > 0) return;
    if (!restore) return;
    await abortableWait(220, signal);
    throwIfAborted(signal);
    if (this.announcementDepth > 0) return;
    this.setMusicBus(this.musicLevel, 450);
  }

  async playVoiceBlob(blob) {
    if (!this.isOperational()) throw new Error('Start Receiver before playing announcements.');
    const context = this.ensureGraph();
    const bytes = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const source = context.createBufferSource();
    const normalizer = context.createGain();
    normalizer.gain.value = normalizedVoiceGain(buffer);
    source.buffer = buffer;
    source.connect(normalizer).connect(this.voiceInput);
    this.voiceSource = source;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let cancelVoice = null;
      const cleanup = () => {
        clearTimeout(timeout);
        if (this.voiceCancel === cancelVoice) this.voiceCancel = null;
        if (this.voiceSource === source) this.voiceSource = null;
        try { source.disconnect(); normalizer.disconnect(); } catch {}
      };
      cancelVoice = (message = 'Announcement audio was cancelled before completion.') => {
        if (settled) return;
        settled = true;
        cleanup();
        try { source.stop(); } catch {}
        reject(new Error(message));
      };
      this.voiceCancel = cancelVoice;
      const timeout = setTimeout(() => {
        cancelVoice('Announcement audio did not complete. Tap Start Receiver again.');
      }, Math.max(6_000, Math.ceil(buffer.duration * 1000) + 5_000));
      source.onended = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      try {
        source.start();
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  }

  async playDeviceSpeech(text, { rate = 0.94, pitch = 1 } = {}) {
    if (!('speechSynthesis' in globalThis)) throw new Error('This browser does not provide device speech.');
    const message = String(text || '').trim();
    if (!message) throw new Error('Announcement text is empty.');
    return await new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = clamp(rate, 0.7, 1.2, 0.94);
      utterance.pitch = clamp(pitch, 0.7, 1.3, 1);
      utterance.volume = this.voiceLevel;
      let settled = false;
      let completionTimer = null;
      const cleanup = () => {
        clearTimeout(startTimer);
        if (completionTimer) clearTimeout(completionTimer);
        if (this.speechCancel === cancelSpeech) this.speechCancel = null;
      };
      const fail = (error, { cancel = false } = {}) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancel) {
          try { globalThis.speechSynthesis.cancel(); } catch {}
        }
        reject(error);
      };
      const startTimer = setTimeout(() => {
        fail(new Error('Device speech did not start. Tap Start Receiver again while this page is visible.'), { cancel: true });
      }, 4_000);
      const cancelSpeech = () => fail(new Error('Device speech was cancelled before completion.'), { cancel: true });
      this.speechCancel = cancelSpeech;
      utterance.onstart = () => {
        if (settled) return;
        clearTimeout(startTimer);
        completionTimer = setTimeout(() => {
          fail(new Error('Device speech did not complete. Tap Start Receiver again while this page is visible.'), { cancel: true });
        }, estimateDeviceSpeechTimeoutMs(message, utterance.rate));
      };
      utterance.onend = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      utterance.onerror = event => {
        fail(new Error(event?.error || 'Device speech failed.'));
      };
      try {
        globalThis.speechSynthesis.cancel();
        globalThis.speechSynthesis.speak(utterance);
      } catch (error) {
        fail(error);
      }
    });
  }

  stopVoice(reason = 'Announcement audio was cancelled before completion.') {
    if (this.voiceCancel) {
      this.voiceCancel(reason);
    } else if (this.voiceSource) {
      try { this.voiceSource.stop(); } catch {}
      this.voiceSource = null;
    }
    if (this.speechCancel) this.speechCancel();
    if ('speechSynthesis' in globalThis) {
      try { speechSynthesis.cancel(); } catch {}
    }
  }

  stopCalibration(reason = 'Sound check stopped.', options = {}) {
    if (reason && typeof reason === 'object' && !(reason instanceof Error)) {
      options = reason;
      reason = options.reason || 'Sound check stopped.';
    }
    const { ok = true, report = true } = options || {};
    const controller = this.calibrationController;
    if (!this.calibrationActive && !controller && !this.builtInBed) return false;
    const error = calibrationAbortError(reason);
    if (controller && !controller.signal.aborted) controller.abort(error);
    this.stopVoice(error.message);
    this.stopBuiltInBed();
    this.announcementDepth = 0;
    if (this.musicBus) this.setMusicBus(this.musicLevel, 60);
    this.calibrationActive = false;
    if (this.calibrationController === controller) this.calibrationController = null;
    if (report) this.report(error.message, ok);
    return true;
  }

  runCalibration({ speak = null } = {}) {
    if (this.calibrationPromise) return this.calibrationPromise;

    const controller = new AbortController();
    const { signal } = controller;
    this.calibrationController = controller;
    this.calibrationActive = true;
    this.report('Sound check starting. Use Stop Sound Check at any time.', true);

    const timeout = setTimeout(() => {
      if (this.calibrationController !== controller || signal.aborted) return;
      this.stopCalibration('Sound check reached its 30-second safety limit and was stopped.', { ok: false });
    }, CALIBRATION_TIMEOUT_MS);

    const task = (async () => {
      let completed = false;
      try {
        // The calibration bed itself is the audible test. Avoid starting a
        // second unlock oscillator that could outlive a cancelled sound check.
        await abortable(this.unlock({ audibleTest: false }), signal);
        throwIfAborted(signal);
        const targetPercent = Math.round(this.musicLevel * 100);
        this.playBuiltInBed({ label: `${targetPercent}% calibration bed` });
        await abortableWait(1_100, signal);
        await this.beginAnnouncement({ signal });
        try {
          const voicePercent = Math.round(this.voiceLevel * 100);
          const message = `Poolside Pulse Version X sound check. Music is at ${targetPercent} percent. This announcement is at ${voicePercent} percent.`;
          const speech = typeof speak === 'function' ? speak(message, { signal }) : this.playDeviceSpeech(message);
          await abortable(speech, signal);
        } finally {
          if (!signal.aborted) await this.endAnnouncement({ signal });
        }
        completed = true;
        return true;
      } finally {
        clearTimeout(timeout);
        this.stopBuiltInBed();
        if (this.announcementDepth > 0) {
          this.announcementDepth = 0;
          if (this.musicBus) this.setMusicBus(this.musicLevel, 80);
        }
        if (this.calibrationController === controller) {
          this.calibrationController = null;
          this.calibrationActive = false;
          if (completed) this.report('Sound check completed and its calibration tone is off.', true);
          else if (!signal.aborted) this.report('Sound check ended early and its calibration tone is off.', false);
        }
      }
    })();

    const wrappedTask = task.finally(() => {
      if (this.calibrationPromise === wrappedTask) this.calibrationPromise = null;
    });
    this.calibrationPromise = wrappedTask;
    return wrappedTask;
  }

  destroy() {
    this.stopCalibration('Sound check stopped because the receiver closed.', { ok: true });
    this.stopVoice();
    this.stopMusic();
    if (this.musicElement) {
      try { this.musicElement.remove(); } catch {}
      this.musicElement = null;
    }
    this.releaseMusicPrime();
    if (this.context) {
      try { this.context.close(); } catch {}
      this.context = null;
    }
    this.musicRamp = null;
    this.unlocked = false;
  }
}
