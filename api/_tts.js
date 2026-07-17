const ALLOWED_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar'
]);

export const NATURAL_SPEECH_DEFAULT_VOICE = 'marin';
export const NATURAL_SPEECH_DEFAULT_INSTRUCTIONS = 'Speak clearly, naturally, warmly, and calmly like a professional resort announcement. For safety messages, sound authoritative without sounding panicked.';
export const NATURAL_SPEECH_MAX_CHARACTERS = 900;
export const NATURAL_SPEECH_MAX_INSTRUCTIONS = 700;
export const NATURAL_SPEECH_UPSTREAM_TIMEOUT_MS = 12_000;
// Leave headroom below Vercel's 4.5 MB buffered response limit. This cap is
// enforced while streaming the provider response so an unexpected upstream
// payload cannot first exhaust the Function's response budget in memory.
export const NATURAL_SPEECH_MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const SAFE_ERRORS = Object.freeze({
  invalid: Object.freeze({
    statusCode: 400,
    message: 'The natural voice request is invalid.'
  }),
  notConfigured: Object.freeze({
    statusCode: 503,
    message: 'Natural voice service is not configured.'
  }),
  busy: Object.freeze({
    statusCode: 429,
    message: 'Natural voice service is busy. Try again shortly.'
  }),
  timeout: Object.freeze({
    statusCode: 504,
    message: 'Natural voice service timed out. Try again shortly.'
  }),
  provider: Object.freeze({
    statusCode: 502,
    message: 'Natural voice service could not generate this announcement.'
  }),
  unavailable: Object.freeze({
    statusCode: 502,
    message: 'Natural voice service is temporarily unavailable.'
  })
});

export class NaturalSpeechError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.provider;
    super(safe.message);
    this.name = 'NaturalSpeechError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'provider';
    this.statusCode = safe.statusCode;
  }
}

function cleanText(value, maximum) {
  const text = String(value || '').trim();
  return text && text.length <= maximum ? text : '';
}

export function normalizeNaturalSpeechRequest(value = {}) {
  const text = cleanText(value?.text, NATURAL_SPEECH_MAX_CHARACTERS);
  if (!text) throw new NaturalSpeechError('invalid');
  const requestedVoice = String(value?.voice || '').trim();
  const voice = ALLOWED_VOICES.has(requestedVoice)
    ? requestedVoice
    : NATURAL_SPEECH_DEFAULT_VOICE;
  const instructions = cleanText(
    value?.instructions || NATURAL_SPEECH_DEFAULT_INSTRUCTIONS,
    NATURAL_SPEECH_MAX_INSTRUCTIONS
  ) || NATURAL_SPEECH_DEFAULT_INSTRUCTIONS;
  return Object.freeze({ text, voice, instructions });
}

async function boundedAudioBuffer(response, maximumBytes = NATURAL_SPEECH_MAX_AUDIO_BYTES) {
  const declaredLength = Number(response?.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    try { await response?.body?.cancel?.(); } catch {}
    return null;
  }

  const reader = response?.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength <= maximumBytes ? buffer : null;
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maximumBytes) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  return Buffer.concat(chunks, total);
}

/**
 * Generates one bounded natural-voice file. Provider diagnostics and secrets
 * are deliberately never included in thrown errors.
 */
export async function generateNaturalSpeech(value, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = NATURAL_SPEECH_UPSTREAM_TIMEOUT_MS,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
  const request = normalizeNaturalSpeechRequest(value);
  const key = String(env?.OPENAI_API_KEY || '').trim();
  if (!key) throw new NaturalSpeechError('notConfigured');
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    throw new NaturalSpeechError('unavailable');
  }

  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(
    () => controller.abort(),
    Math.max(1_000, Number(timeoutMs) || NATURAL_SPEECH_UPSTREAM_TIMEOUT_MS)
  );
  try {
    let lastStatus = 0;
    for (const format of ['wav', 'mp3']) {
      const response = await fetchImpl('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: request.voice,
          input: request.text,
          instructions: request.instructions,
          response_format: format
        })
      });

      if (response?.ok) {
        const buffer = await boundedAudioBuffer(response);
        if (buffer?.length) {
          return Object.freeze({
            buffer,
            format,
            contentType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
            voice: request.voice
          });
        }
        // WAV can exceed the safe Function response budget for long speech.
        // Retry once as MP3, which is substantially smaller.
        if (format !== 'wav') throw new NaturalSpeechError('provider');
        continue;
      }

      try { await response?.arrayBuffer?.(); } catch {}
      lastStatus = Number(response?.status) || 0;
      if (format !== 'wav') break;
    }

    throw new NaturalSpeechError(lastStatus === 429 ? 'busy' : 'provider');
  } catch (error) {
    if (error instanceof NaturalSpeechError) throw error;
    if (controller.signal?.aborted || error?.name === 'AbortError') {
      throw new NaturalSpeechError('timeout');
    }
    throw new NaturalSpeechError('unavailable');
  } finally {
    clearTimeoutImpl(timer);
  }
}
