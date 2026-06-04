function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const RESORT_FALLBACK = {
  ok: true,
  latitude: 36.6337,
  longitude: -93.4166,
  matchedAddress: 'Serenity Shores / Kimberling City fallback coordinates',
  fallback: true,
  warning: 'The public geocoder could not match the private resort street address. These are fallback coordinates for the Kimberling City / Serenity Shores area. For operational safety, confirm once with Use Device Location at the pool sound system.'
};

function looksLikeResort(address) {
  const a = String(address || '').toLowerCase();
  return a.includes('serenity shores') || (a.includes('kimberling') && a.includes('615')) || a.includes('table rock lake resort');
}

export default async function handler(req, res) {
  const address = String(req.query?.address || '').trim();
  if (!address) return json(res, 400, { ok: false, error: 'Address is required.' });
  try {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.searchParams.set('address', address);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('format', 'json');
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'PoolsideRadio/3.1' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Census geocoder returned HTTP ${response.status}`);
    const match = data?.result?.addressMatches?.[0];
    if (!match?.coordinates) {
      if (looksLikeResort(address)) return json(res, 200, RESORT_FALLBACK);
      throw new Error('No address match found. Try a fuller street address or enter latitude/longitude manually.');
    }
    return json(res, 200, {
      ok: true,
      latitude: match.coordinates.y,
      longitude: match.coordinates.x,
      matchedAddress: match.matchedAddress || address
    });
  } catch (error) {
    if (looksLikeResort(address)) return json(res, 200, RESORT_FALLBACK);
    return json(res, 500, { ok: false, error: error.message || 'Geocoding failed.' });
  }
}
