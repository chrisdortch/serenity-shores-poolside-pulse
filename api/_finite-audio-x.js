import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const AUDIO_EXTENSIONS = Object.freeze(new Set([
  'aac',
  'm4a',
  'mp3',
  'wav'
]));
const AUDIO_CONTENT_TYPES = Object.freeze(new Set([
  'application/octet-stream',
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/x-wav'
]));
const SUNO_HOSTS = Object.freeze(new Set(['suno.com', 'www.suno.com']));
const SUNO_PATH_PATTERN = /^\/(song|songs|s)\/([A-Za-z0-9-]+)\/?$/i;
const UNSAFE_HOST_SUFFIX_PATTERN = /(?:^|\.)(?:internal|intranet|local|localhost|home|lan)$/i;
const MAX_REFERENCE_LENGTH = 2_048;
const MAX_SUNO_HTML_BYTES = 2_000_000;
// Vercel Functions cap request and response bodies at 4.5 MB. Leave headroom
// for platform framing instead of accepting a file that cannot be returned.
export const FINITE_AUDIO_X_MAX_BYTES = 4 * 1024 * 1024;
export const FINITE_AUDIO_X_MAX_SECONDS = 180;
export const FINITE_AUDIO_X_TIMEOUT_MS = 18_000;

const SAFE_ERRORS = Object.freeze({
  invalid: Object.freeze({
    statusCode: 400,
    message: 'The finite announcement audio source is invalid.'
  }),
  ambiguous: Object.freeze({
    statusCode: 400,
    message: 'That Suno page did not identify one exact playable song.'
  }),
  timeout: Object.freeze({
    statusCode: 504,
    message: 'The finite announcement audio source did not respond in time.'
  }),
  tooLarge: Object.freeze({
    statusCode: 413,
    message: 'The finite announcement audio file is too large.'
  }),
  unsupported: Object.freeze({
    statusCode: 415,
    message: 'The finite announcement source did not return supported audio.'
  }),
  tooLong: Object.freeze({
    statusCode: 422,
    message: 'The finite announcement audio is longer than its allowed duration.'
  }),
  unavailable: Object.freeze({
    statusCode: 502,
    message: 'The finite announcement audio is temporarily unavailable.'
  })
});

export class FiniteAudioXError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.unavailable;
    super(safe.message);
    this.name = 'FiniteAudioXError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'unavailable';
    this.statusCode = safe.statusCode;
  }
}

function invalid(code = 'invalid') {
  throw new FiniteAudioXError(code);
}

function cleanHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function ipv4Parts(address) {
  const parts = String(address || '').split('.').map(Number);
  return parts.length === 4
    && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function unsafeIpv4(address) {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51)
    || (a === 203 && b === 0)
    || a >= 224
  );
}

function unsafeIpv6(address) {
  const normalized = String(address || '').trim().toLowerCase().split('%')[0];
  const value = ipv6Value(normalized);
  if (value == null || value === 0n || value === 1n) return true;
  if (ipv6InRange(value, 'fc00::', 7)) return true;
  if (ipv6InRange(value, 'fe80::', 10)) return true;
  if (ipv6InRange(value, 'fec0::', 10)) return true;
  if (ipv6InRange(value, 'ff00::', 8)) return true;
  if (ipv6InRange(value, '2001:db8::', 32)) return true;
  // Reject transition forms that can hide a private IPv4 destination from the
  // resolver check, including hexadecimal IPv4-mapped notation.
  if (ipv6InRange(value, '::ffff:0:0', 96)) return true;
  if (ipv6InRange(value, '::', 96)) return true;
  if (ipv6InRange(value, '64:ff9b::', 96)) return true;
  if (ipv6InRange(value, '64:ff9b:1::', 48)) return true;
  if (ipv6InRange(value, '2001::', 32)) return true;
  if (ipv6InRange(value, '2002::', 16)) return true;
  return false;
}

function ipv6Value(address) {
  const normalized = String(address || '').trim().toLowerCase().split('%')[0];
  if (!normalized || normalized.includes(':::')) return null;
  const pieces = normalized.split('::');
  if (pieces.length > 2) return null;
  const parseSide = side => {
    if (!side) return [];
    const words = side.split(':');
    const result = [];
    for (const word of words) {
      if (!word) return null;
      if (word.includes('.')) {
        const parts = ipv4Parts(word);
        if (!parts) return null;
        result.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(word)) return null;
        result.push(Number.parseInt(word, 16));
      }
    }
    return result;
  };
  const left = parseSide(pieces[0]);
  const right = parseSide(pieces[1] || '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (pieces.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill(0), ...right];
  if (words.length !== 8) return null;
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function ipv6InRange(value, prefix, bits) {
  const prefixValue = ipv6Value(prefix);
  if (prefixValue == null) return false;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (prefixValue >> shift);
}

function unsafeAddress(address) {
  const family = isIP(String(address || ''));
  if (family === 4) return unsafeIpv4(address);
  if (family === 6) return unsafeIpv6(address);
  return true;
}

function safeHttpsUrl(input, {
  requireAudioExtension = false,
  sunoOnly = false
} = {}) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > MAX_REFERENCE_LENGTH) invalid();
  let url;
  try {
    url = new URL(raw);
  } catch {
    invalid();
  }
  const hostname = cleanHostname(url.hostname);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || !hostname
    || UNSAFE_HOST_SUFFIX_PATTERN.test(hostname)
  ) invalid();
  const literalFamily = isIP(hostname);
  if (literalFamily && unsafeAddress(hostname)) invalid();
  if (sunoOnly && !SUNO_HOSTS.has(hostname)) invalid();
  if (requireAudioExtension && !audioExtension(url)) invalid();
  url.hash = '';
  return url;
}

function audioExtension(input) {
  const pathname = input instanceof URL
    ? input.pathname
    : safeHttpsUrl(input).pathname;
  const match = pathname.match(/\.([A-Za-z0-9]+)$/);
  const extension = String(match?.[1] || '').toLowerCase();
  return AUDIO_EXTENSIONS.has(extension) ? extension : '';
}

function sunoResource(input) {
  const url = safeHttpsUrl(input, { sunoOnly: true });
  const match = url.pathname.match(SUNO_PATH_PATTERN);
  if (!match) invalid();
  return Object.freeze({
    url: url.toString(),
    type: match[1].toLowerCase() === 's' ? 'share' : 'song',
    id: match[2]
  });
}

/**
 * Normalizes the only two finite announcement source types accepted by the
 * signed delivery endpoint. Apple Music and Spotify catalog URLs deliberately
 * do not fit this contract because they are not finite downloadable files.
 */
export function normalizeFiniteAudioReference(provider, input) {
  const cleanProvider = String(provider || '').trim().toLowerCase();
  if (cleanProvider === 'direct') {
    const url = safeHttpsUrl(input, { requireAudioExtension: true });
    return Object.freeze({
      provider: 'direct',
      sourceUrl: url.toString(),
      extension: audioExtension(url)
    });
  }
  if (cleanProvider === 'suno') {
    const resource = sunoResource(input);
    return Object.freeze({
      provider: 'suno',
      sourceUrl: resource.url,
      extension: '',
      resource
    });
  }
  invalid();
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const value = headers[name] ?? headers[String(name).toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

async function limitedResponseText(response, maxBytes = MAX_SUNO_HTML_BYTES) {
  const declared = Number(headerValue(response?.headers, 'content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) invalid('tooLarge');
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) invalid('tooLarge');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      invalid('tooLarge');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWithTimeout(url, {
  fetchImpl,
  timeoutMs,
  headers = {}
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers
    });
  } catch (error) {
    if (error?.name === 'AbortError') invalid('timeout');
    throw new FiniteAudioXError('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function canonicalSunoResource(html) {
  const source = String(html || '');
  const tags = source.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (!href) continue;
    try {
      return sunoResource(href.replace(/&amp;/g, '&'));
    } catch {}
  }
  return null;
}

function collectExactAudioCandidates(value, expectedId, out) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(item => collectExactAudioCandidates(item, expectedId, out));
    return;
  }
  const objectId = String(value.id || value.clip_id || value.clipId || '').trim().toLowerCase();
  const exactObject = objectId === expectedId;
  for (const key of ['audio_url', 'audioUrl', 'stream_audio_url', 'streamAudioUrl']) {
    const candidate = String(value[key] || '').trim();
    if (!candidate) continue;
    try {
      const parsed = safeHttpsUrl(candidate, { requireAudioExtension: true });
      const exactPath = parsed.pathname.toLowerCase().includes(`/${expectedId}.`);
      if (exactObject || exactPath) out.push(parsed.toString());
    } catch {}
  }
  Object.values(value).forEach(item => collectExactAudioCandidates(item, expectedId, out));
}

function parseJsonCandidate(raw, expectedId, out) {
  const input = String(raw || '').trim();
  if (!input) return;
  const variants = [
    input,
    input.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  ];
  for (const variant of variants) {
    const payloads = [variant];
    const colon = variant.indexOf(':');
    if (colon > 0 && /^[\w$-]+:/.test(variant)) payloads.push(variant.slice(colon + 1));
    for (const payload of payloads) {
      try {
        collectExactAudioCandidates(JSON.parse(payload), expectedId, out);
      } catch {}
    }
  }
}

function looseAudioValues(html) {
  const values = [];
  const sources = [
    String(html || ''),
    String(html || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  ];
  for (const key of ['audio_url', 'audioUrl', 'stream_audio_url', 'streamAudioUrl']) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'gi');
    for (const source of sources) {
      let match;
      while ((match = pattern.exec(source))) {
        values.push(String(match[1] || '')
          .replace(/\\u0026/g, '&')
          .replace(/\\u002F/g, '/')
          .replace(/\\\//g, '/')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\'));
      }
    }
  }
  return values;
}

function exactSunoAudioUrls(html, expectedId) {
  const matches = [];
  const scripts = String(html || '').match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    parseJsonCandidate(body, expectedId, matches);
    const flightPattern = /self\.__next_f\.push\(\[(?:1|2),"([\s\S]*?)"\]\)/g;
    let flight;
    while ((flight = flightPattern.exec(body))) parseJsonCandidate(flight[1], expectedId, matches);
  }
  for (const candidate of looseAudioValues(html)) {
    try {
      const parsed = safeHttpsUrl(candidate, { requireAudioExtension: true });
      if (parsed.pathname.toLowerCase().includes(`/${expectedId}.`)) {
        matches.push(parsed.toString());
      }
    } catch {}
  }
  return [...new Set(matches)];
}

async function resolveSunoAudio(reference, {
  fetchImpl,
  timeoutMs
}) {
  let resource = reference.resource || sunoResource(reference.sourceUrl);
  let response;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await fetchWithTimeout(resource.url, {
      fetchImpl,
      timeoutMs,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; PoolsidePulseX/1.0)'
      }
    });
    if (response.status < 300 || response.status >= 400) break;
    if (redirects === 3) invalid('ambiguous');
    const location = headerValue(response.headers, 'location');
    if (!location) invalid('ambiguous');
    let redirected;
    try {
      redirected = sunoResource(new URL(location, resource.url).toString());
    } catch {
      invalid('ambiguous');
    }
    if (resource.type === 'song' && (
      redirected.type !== 'song'
      || redirected.id.toLowerCase() !== resource.id.toLowerCase()
    )) invalid('ambiguous');
    resource = redirected;
  }
  if (!response || !response.ok) throw new FiniteAudioXError('unavailable');
  const html = await limitedResponseText(response);
  const canonical = canonicalSunoResource(html);
  if (canonical?.type !== 'song') {
    if (resource.type === 'share') invalid('ambiguous');
    if (canonical && canonical.type !== 'song') invalid('ambiguous');
  }
  if (resource.type === 'song' && canonical && (
    canonical.type !== 'song'
    || canonical.id.toLowerCase() !== resource.id.toLowerCase()
  )) invalid('ambiguous');
  const exact = canonical?.type === 'song' ? canonical : resource;
  if (exact.type !== 'song') invalid('ambiguous');
  const candidates = exactSunoAudioUrls(html, exact.id.toLowerCase());
  if (!candidates.length) invalid('ambiguous');
  const preferred = candidates.find(url => audioExtension(url) === 'mp3')
    || candidates.find(url => audioExtension(url) === 'm4a')
    || candidates[0];
  return Object.freeze({
    provider: 'suno',
    sourceUrl: reference.sourceUrl,
    resolvedUrl: preferred,
    extension: audioExtension(preferred),
    evidence: 'exact-suno-song-id'
  });
}

/**
 * Resolves a normalized finite source to one exact downloadable audio URL.
 * Suno playlists are never accepted and recommendation objects are ignored.
 */
export async function resolveFiniteAudioReference(reference, {
  fetchImpl = globalThis.fetch,
  timeoutMs = FINITE_AUDIO_X_TIMEOUT_MS
} = {}) {
  if (!reference || typeof reference !== 'object') invalid();
  if (reference.provider === 'direct') {
    const normalized = normalizeFiniteAudioReference('direct', reference.sourceUrl);
    return Object.freeze({
      ...normalized,
      resolvedUrl: normalized.sourceUrl,
      evidence: 'finite-file-extension'
    });
  }
  if (reference.provider === 'suno') {
    if (typeof fetchImpl !== 'function') throw new FiniteAudioXError('unavailable');
    const normalized = normalizeFiniteAudioReference('suno', reference.sourceUrl);
    return resolveSunoAudio(normalized, { fetchImpl, timeoutMs });
  }
  invalid();
}

async function pinnedAddress(hostname, lookupImpl, timeoutMs) {
  if (isIP(hostname)) {
    if (unsafeAddress(hostname)) invalid();
    return { address: hostname, family: isIP(hostname) };
  }
  let records;
  let timer;
  try {
    records = await Promise.race([
      lookupImpl(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new FiniteAudioXError('timeout')), timeoutMs);
      })
    ]);
  } catch (error) {
    if (error instanceof FiniteAudioXError) throw error;
    throw new FiniteAudioXError('unavailable');
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(records) || !records.length) throw new FiniteAudioXError('unavailable');
  if (records.some(record => unsafeAddress(record?.address))) invalid();
  const selected = records.find(record => record?.family === 4) || records[0];
  return { address: selected.address, family: selected.family };
}

function contentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function hasAudioSignature(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 4) return false;
  if (extension === 'mp3') {
    return buffer.subarray(0, 3).toString('ascii') === 'ID3'
      || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  }
  if (extension === 'wav') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  }
  if (extension === 'm4a') return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  if (extension === 'aac') return buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0;
  return false;
}

function wavDurationSeconds(buffer) {
  if (
    buffer.byteLength < 44
    || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) return 0;
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.byteLength) return 0;
    if (type === 'fmt ' && size >= 12) byteRate = buffer.readUInt32LE(body + 8);
    if (type === 'data') {
      dataBytes = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  return byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : 0;
}

function synchsafeInteger(buffer, offset) {
  if (offset + 4 > buffer.byteLength) return 0;
  const bytes = buffer.subarray(offset, offset + 4);
  if ([...bytes].some(byte => (byte & 0x80) !== 0)) return 0;
  return ((bytes[0] & 0x7f) << 21)
    | ((bytes[1] & 0x7f) << 14)
    | ((bytes[2] & 0x7f) << 7)
    | (bytes[3] & 0x7f);
}

function mp3Frame(header) {
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return null;
  const versionBits = (header >>> 19) & 0x3;
  const layerBits = (header >>> 17) & 0x3;
  const bitrateIndex = (header >>> 12) & 0xf;
  const sampleRateIndex = (header >>> 10) & 0x3;
  const padding = (header >>> 9) & 0x1;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }
  const mpeg1 = versionBits === 3;
  const bitrates = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const divisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = [44_100, 48_000, 32_000][sampleRateIndex] / divisor;
  const bitrate = bitrates[bitrateIndex];
  const samples = mpeg1 ? 1_152 : 576;
  const frameLength = Math.floor((mpeg1 ? 144_000 : 72_000) * bitrate / sampleRate) + padding;
  return Number.isFinite(frameLength) && frameLength >= 4
    ? { frameLength, sampleRate, samples }
    : null;
}

function mp3DurationSeconds(buffer) {
  let offset = buffer.subarray(0, 3).toString('ascii') === 'ID3'
    ? 10 + synchsafeInteger(buffer, 6)
    : 0;
  let totalSeconds = 0;
  let frames = 0;
  while (offset + 4 <= buffer.byteLength) {
    const frame = mp3Frame(buffer.readUInt32BE(offset));
    if (!frame || offset + frame.frameLength > buffer.byteLength) {
      if (frames > 0) break;
      offset += 1;
      continue;
    }
    totalSeconds += frame.samples / frame.sampleRate;
    frames += 1;
    offset += frame.frameLength;
  }
  return frames > 0 ? totalSeconds : 0;
}

function aacDurationSeconds(buffer) {
  const sampleRates = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
    22_050, 16_000, 12_000, 11_025, 8_000, 7_350
  ];
  let offset = 0;
  let totalSeconds = 0;
  let frames = 0;
  while (offset + 7 <= buffer.byteLength) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xf6) !== 0xf0) return 0;
    const sampleRate = sampleRates[(buffer[offset + 2] & 0x3c) >>> 2];
    const frameLength = ((buffer[offset + 3] & 0x03) << 11)
      | (buffer[offset + 4] << 3)
      | ((buffer[offset + 5] & 0xe0) >>> 5);
    if (!sampleRate || frameLength < 7 || offset + frameLength > buffer.byteLength) return 0;
    totalSeconds += (1_024 * ((buffer[offset + 6] & 0x03) + 1)) / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  return frames > 0 && offset === buffer.byteLength ? totalSeconds : 0;
}

const MP4_CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia']);

function mp4BoxDuration(buffer, start = 0, end = buffer.byteLength, depth = 0) {
  if (depth > 4) return 0;
  for (let offset = start; offset + 8 <= end;) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    let headerBytes = 8;
    if (size === 1) {
      if (offset + 16 > end) return 0;
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
      size = Number(largeSize);
      headerBytes = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerBytes || offset + size > end) return 0;
    const body = offset + headerBytes;
    const boxEnd = offset + size;
    if (type === 'mvhd' || type === 'mdhd') {
      const version = buffer[body];
      const timescaleOffset = version === 1 ? body + 20 : body + 12;
      const durationOffset = version === 1 ? body + 24 : body + 16;
      const durationBytes = version === 1 ? 8 : 4;
      if (durationOffset + durationBytes > boxEnd) return 0;
      const timescale = buffer.readUInt32BE(timescaleOffset);
      const duration = version === 1
        ? Number(buffer.readBigUInt64BE(durationOffset))
        : buffer.readUInt32BE(durationOffset);
      if (timescale > 0 && Number.isFinite(duration) && duration > 0) return duration / timescale;
    }
    if (MP4_CONTAINER_TYPES.has(type)) {
      const nested = mp4BoxDuration(buffer, body, boxEnd, depth + 1);
      if (nested > 0) return nested;
    }
    offset = boxEnd;
  }
  return 0;
}

function audioDurationSeconds(buffer, extension) {
  if (extension === 'wav') return wavDurationSeconds(buffer);
  if (extension === 'mp3') return mp3DurationSeconds(buffer);
  if (extension === 'aac') return aacDurationSeconds(buffer);
  if (extension === 'm4a') return mp4BoxDuration(buffer);
  return 0;
}

async function requestAudioOnce(url, {
  deadlineAt,
  lookupImpl,
  requestImpl,
  maxBytes
}) {
  const parsed = safeHttpsUrl(url);
  const remainingMs = Math.max(1, deadlineAt - Date.now());
  const pinned = await pinnedAddress(cleanHostname(parsed.hostname), lookupImpl, remainingMs);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const request = requestImpl(parsed, {
      method: 'GET',
      headers: {
        'Accept': 'audio/*,application/octet-stream;q=0.5',
        'User-Agent': 'PoolsidePulseX/1.0'
      },
      servername: parsed.hostname,
      lookup(_hostname, _options, callback) {
        callback(null, pinned.address, pinned.family);
      }
    }, response => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = headerValue(response.headers, 'location');
        response.resume();
        if (!location) return finish(new FiniteAudioXError('unavailable'));
        try {
          return finish(null, {
            redirect: safeHttpsUrl(new URL(location, parsed).toString()).toString()
          });
        } catch {
          return finish(new FiniteAudioXError('invalid'));
        }
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return finish(new FiniteAudioXError('unavailable'));
      }
      const type = contentType(headerValue(response.headers, 'content-type'));
      if (!AUDIO_CONTENT_TYPES.has(type)) {
        response.resume();
        return finish(new FiniteAudioXError('unsupported'));
      }
      const declared = Number(headerValue(response.headers, 'content-length') || 0);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.resume();
        return finish(new FiniteAudioXError('tooLarge'));
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          response.destroy(new FiniteAudioXError('tooLarge'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => finish(null, {
        buffer: Buffer.concat(chunks),
        contentType: type,
        finalUrl: parsed.toString()
      }));
      response.on('error', error => finish(
        error instanceof FiniteAudioXError ? error : new FiniteAudioXError('unavailable')
      ));
    });
    request.setTimeout(remainingMs, () => {
      request.destroy(new FiniteAudioXError('timeout'));
    });
    request.on('error', error => finish(
      error instanceof FiniteAudioXError ? error : new FiniteAudioXError('unavailable')
    ));
    request.end();
  });
}

async function fetchPinnedAudio(url, {
  lookupImpl,
  requestImpl,
  maxBytes,
  timeoutMs
}) {
  const deadlineAt = Date.now() + timeoutMs;
  let current = safeHttpsUrl(url).toString();
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (Date.now() >= deadlineAt) invalid('timeout');
    const result = await requestAudioOnce(current, {
      deadlineAt,
      lookupImpl,
      requestImpl,
      maxBytes
    });
    if (!result.redirect) return result;
    if (redirects === 3) throw new FiniteAudioXError('unavailable');
    current = result.redirect;
  }
  throw new FiniteAudioXError('unavailable');
}

/**
 * Resolves and downloads one finite announcement into a bounded in-memory
 * buffer. The outbound HTTPS request is DNS-pinned to a verified public
 * address, follows at most three verified HTTPS redirects, and enforces both a
 * total deadline and byte ceiling.
 */
export async function loadFiniteAnnouncementAudio({
  provider,
  sourceUrl,
  maxDurationSeconds = FINITE_AUDIO_X_MAX_SECONDS
}, {
  fetchImpl = globalThis.fetch,
  lookupImpl = dnsLookup,
  requestImpl = httpsRequest,
  maxBytes = FINITE_AUDIO_X_MAX_BYTES,
  timeoutMs = FINITE_AUDIO_X_TIMEOUT_MS
} = {}) {
  let timer;
  const operation = (async () => {
    const startedAt = Date.now();
    const reference = normalizeFiniteAudioReference(provider, sourceUrl);
    const resolved = await resolveFiniteAudioReference(reference, {
      fetchImpl,
      timeoutMs
    });
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const downloaded = await fetchPinnedAudio(resolved.resolvedUrl, {
      lookupImpl,
      requestImpl,
      maxBytes,
      timeoutMs: remainingMs
    });
    const finalExtension = audioExtension(downloaded.finalUrl) || resolved.extension;
    if (!finalExtension || !hasAudioSignature(downloaded.buffer, finalExtension)) {
      throw new FiniteAudioXError('unsupported');
    }
    const allowedDuration = Number(maxDurationSeconds);
    if (
      !Number.isInteger(allowedDuration)
      || allowedDuration < 1
      || allowedDuration > FINITE_AUDIO_X_MAX_SECONDS
    ) {
      throw new FiniteAudioXError('invalid');
    }
    const durationSeconds = audioDurationSeconds(downloaded.buffer, finalExtension);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new FiniteAudioXError('unsupported');
    }
    if (durationSeconds > allowedDuration + 0.25) {
      throw new FiniteAudioXError('tooLong');
    }
    return Object.freeze({
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      extension: finalExtension,
      provider: resolved.provider,
      evidence: resolved.evidence,
      byteLength: downloaded.buffer.byteLength,
      durationSeconds
    });
  })();
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new FiniteAudioXError('timeout')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
