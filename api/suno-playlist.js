function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function extractPlaylistId(input) {
  const raw = String(input || '').trim();
  const patterns = [
    /suno\.com\/(?:playlist|playlists)\/([a-zA-Z0-9-]+)/i,
    /(?:^|[?&])id=([a-zA-Z0-9-]+)/i,
    /^([a-zA-Z0-9-]{20,80})$/
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.findIndex(p => p === 'playlist' || p === 'playlists');
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {}
  return '';
}

function queryParams(req) {
  const rawUrl = String(req.url || '');
  if (rawUrl) {
    try {
      return Object.fromEntries(new URL(rawUrl, 'https://poolside.local').searchParams.entries());
    } catch {}
  }
  return req.query || {};
}

function durationFromSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '3:00';
  const rounded = Math.round(n);
  const m = Math.floor(rounded / 60);
  const s = String(rounded % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function normalTrack(clip, no, playlistUrl) {
  const meta = clip?.metadata || {};
  const duration = meta.duration ?? clip.duration ?? clip.duration_seconds ?? clip.durationSeconds;
  const artist = clip.display_name || clip.user_display_name || clip.user?.display_name || clip.user?.username || clip.artist || clip.handle || 'Suno';
  return {
    id: clip.id || clip.clip_id || `track-${no}`,
    no,
    title: String(clip.title || clip.name || `Suno Track ${no}`),
    artist: String(artist || 'Suno'),
    duration: typeof duration === 'string' && duration.includes(':') ? duration : durationFromSeconds(duration),
    tags: String(meta.tags || clip.tags || ''),
    audioUrl: String(clip.audio_url || clip.audioUrl || ''),
    sourceUrl: String(clip.share_url || clip.url || (clip.id ? `https://suno.com/song/${clip.id}` : playlistUrl)),
    imageUrl: String(clip.image_url || clip.image_large_url || '')
  };
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter(track => {
    const key = String(track.id || `${track.title}|${track.audioUrl || track.sourceUrl}`).toLowerCase();
    if (!track.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 300);
}

async function fetchJson(url, playlistUrl) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      'Origin': 'https://suno.com',
      'Referer': playlistUrl || 'https://suno.com/'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Suno returned non-JSON from ${url}`); }
}

async function fetchFromSunoPlaylistApi(playlistId, playlistUrl) {
  const hosts = ['https://studio-api.prod.suno.com', 'https://studio-api-prod.suno.com'];
  const errors = [];

  for (const host of hosts) {
    const tracks = [];
    let playlistName = '';
    let playlistImage = '';
    for (let page = 1; page <= 30; page++) {
      let data;
      try {
        data = await fetchJson(`${host}/api/playlist/${encodeURIComponent(playlistId)}/?page=${page}`, playlistUrl);
      } catch (error) {
        errors.push(error.message);
        break;
      }

      playlistName = data.name || data.playlist?.name || playlistName;
      playlistImage = data.image_url || data.playlist?.image_url || playlistImage;
      const rawClips = data.playlist_clips || data.clips || data.items || [];
      const clips = rawClips.map(item => item.clip || item.content_item || item).filter(Boolean);
      if (!clips.length) break;
      clips.forEach(clip => tracks.push(normalTrack(clip, tracks.length + 1, playlistUrl)));
      if (data.next === null || data.has_more === false || rawClips.length < 20) break;
    }
    const cleaned = uniqueTracks(tracks);
    if (cleaned.length) return { tracks: cleaned, playlistName, playlistImage, source: `${host}/api/playlist` };
  }
  throw new Error(errors[0] || 'Suno playlist API returned no tracks.');
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
  if (title && (audioUrl || sourceUrl || value.id || value.clip_id || value.entity_type === 'song_schema' || value.entity_type === 'song')) {
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
    const pushedMatches = body.match(/self\.__next_f\.push\(\[(?:1|2),"([\s\S]*?)"\]\)/g) || [];
    pushedMatches.forEach(segment => {
      try {
        const text = segment.replace(/^self\.__next_f\.push\(\[(?:1|2),"/, '').replace(/"\]\)$/, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        collectObjects(JSON.parse(text), tracks);
      } catch {}
    });
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

async function fetchFromHtml(playlistUrl) {
  const response = await fetch(playlistUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`Suno page returned HTTP ${response.status}`);
  return uniqueTracks([...parseJsonScripts(html), ...parseLoosePatterns(html)]);
}

export default async function handler(req, res) {
  const playlistUrl = String(queryParams(req).url || '');
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) return json(res, 400, { ok: false, error: 'Provide a valid Suno playlist URL or playlist ID.' });

  try {
    const apiResult = await fetchFromSunoPlaylistApi(playlistId, playlistUrl);
    return json(res, 200, {
      ok: true,
      tracks: apiResult.tracks,
      count: apiResult.tracks.length,
      playlistName: apiResult.playlistName,
      playlistImage: apiResult.playlistImage,
      source: apiResult.source,
      audioWarning: apiResult.tracks.some(t => t.audioUrl) ? '' : 'titles only; no public playable audio URLs found'
    });
  } catch (apiError) {
    try {
      const htmlTracks = await fetchFromHtml(playlistUrl.startsWith('http') ? playlistUrl : `https://suno.com/playlist/${playlistId}`);
      if (!htmlTracks.length) throw new Error('HTML fallback found no tracks.');
      return json(res, 200, { ok: true, tracks: htmlTracks, count: htmlTracks.length, source: 'html-fallback', warning: apiError.message, audioWarning: htmlTracks.some(t => t.audioUrl) ? '' : 'titles only; no public playable audio URLs found' });
    } catch (htmlError) {
      return json(res, 500, { ok: false, error: `${apiError.message}; fallback: ${htmlError.message}` });
    }
  }
}
