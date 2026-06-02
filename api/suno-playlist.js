function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function uniqTracks(tracks) {
  const seen = new Set();
  return tracks.filter(track => {
    const key = `${track.title}|${track.artist}`.toLowerCase();
    if (!track.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
}

function durationFromSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '3:00';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function collectObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectObjects(item, out));
    return out;
  }
  const title = value.title || value.name || value.display_name;
  const audioUrl = value.audio_url || value.audioUrl || value.audio || value.stream_audio_url || value.video_url || value.videoUrl || '';
  const sourceUrl = value.url || value.share_url || value.shareUrl || value.permalink || '';
  const duration = value.duration || value.duration_seconds || value.durationSeconds || value.metadata?.duration;
  const artist = value.artist || value.user?.display_name || value.user?.username || value.creator || value.handle || 'Suno';
  if (title && (audioUrl || sourceUrl || value.id || value.clip_id || value.entity_type === 'song')) {
    out.push({ title: String(title), artist: String(artist || 'Suno'), duration: typeof duration === 'string' ? duration : durationFromSeconds(duration), audioUrl: String(audioUrl || ''), sourceUrl: String(sourceUrl || '') });
  }
  Object.values(value).forEach(item => collectObjects(item, out));
  return out;
}

function parseJsonScripts(html) {
  const tracks = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html))) {
    const body = match[1].trim();
    if (!body || (!body.includes('playlist') && !body.includes('audio') && !body.includes('clip') && !body.includes('title'))) continue;
    if (body.startsWith('{') || body.startsWith('[')) {
      try { collectObjects(JSON.parse(body), tracks); } catch {}
    }
  }
  return tracks;
}

function parseLoosePatterns(html) {
  const tracks = [];
  const regex = /"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match;
  while ((match = regex.exec(html))) {
    const title = match[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"').trim();
    if (title && !title.toLowerCase().includes('suno')) tracks.push({ title, artist: 'Suno', duration: '3:00', audioUrl: '', sourceUrl: '' });
  }
  return tracks;
}

export default async function handler(req, res) {
  const playlistUrl = String(req.query?.url || '');
  if (!playlistUrl || !/^https:\/\/(www\.)?suno\.com\//i.test(playlistUrl)) {
    return json(res, 400, { ok: false, error: 'Provide a valid https://suno.com playlist URL.' });
  }
  try {
    const response = await fetch(playlistUrl, {
      headers: {
        'User-Agent': 'Serenity Shores Poolside Pulse playlist importer (contact: chrisdortch@gmail.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`Suno returned HTTP ${response.status}`);
    const tracks = uniqTracks([...parseJsonScripts(html), ...parseLoosePatterns(html)]);
    return json(res, 200, { ok: true, tracks, count: tracks.length, audioWarning: tracks.some(t => t.audioUrl) ? '' : 'titles only; no public playable audio URLs found' });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || 'Could not fetch Suno playlist.' });
  }
}
