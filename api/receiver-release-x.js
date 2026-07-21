import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import { releaseVersionXReceiverSession } from './state-x.js';

const MAX_REQUEST_BYTES = 2_000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin, Cookie');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export function createReceiverReleaseXHandler({
  releaseReceiver = releaseVersionXReceiverSession
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'POST required.' });
    }
    const loginSession = requireSession(req, res);
    if (!loginSession) return;
    const rate = consumeRateLimit(`receiver-release:x:${loginSession.sid}:${clientIp(req)}`, {
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS
    });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, { ok: false, error: 'Too many receiver release requests. Try again shortly.' });
    }

    let body;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BYTES);
    } catch (error) {
      const tooLarge = error?.message === 'Request too large.';
      return json(res, tooLarge ? 413 : 400, {
        ok: false,
        error: tooLarge ? 'Receiver release request is too large.' : 'Invalid JSON body.'
      });
    }

    const receiverId = String(body?.receiverId || '').trim();
    const sessionId = String(body?.sessionId || '').trim();
    const version = String(body?.version || '').trim().toLowerCase();
    const mode = String(body?.mode || 'pushcut').trim().toLowerCase();
    if (version !== 'x') {
      return json(res, 400, { ok: false, error: 'Version X receiver release requires version "x".' });
    }
    if (!['browser', 'pushcut'].includes(mode)) {
      return json(res, 400, { ok: false, error: 'Receiver release mode must be "browser" or "pushcut".' });
    }
    if (!receiverId || !sessionId || receiverId.length > 160 || sessionId.length > 160) {
      return json(res, 400, { ok: false, error: 'receiverId and sessionId are required.' });
    }

    try {
      const result = await releaseReceiver({ receiverId, sessionId, mode, requireDurable: true });
      if (!result.matched) {
        return json(res, 409, {
          ok: false,
          released: false,
          error: 'This Browser Receiver session no longer owns the speaker lease.',
          currentRevision: result.revision
        });
      }
      return json(res, 200, {
        ok: true,
        version: 'x',
        released: true,
        changed: result.changed === true,
        receiverMode: mode,
        revision: result.revision,
        receiver: result.state?.receiver || null,
        state: result.state || null
      });
    } catch (error) {
      const status = [400, 409, 503].includes(Number(error?.statusCode))
        ? Number(error.statusCode)
        : 500;
      return json(res, status, {
        ok: false,
        released: false,
        error: status < 500
          ? String(error.message || 'Receiver release failed.')
          : 'Receiver release failed.'
      });
    }
  };
}

export default createReceiverReleaseXHandler();
