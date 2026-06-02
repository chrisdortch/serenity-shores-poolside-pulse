function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
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
      headers: { 'User-Agent': 'Serenity Shores Poolside Pulse (contact: chrisdortch@gmail.com)' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Census geocoder returned HTTP ${response.status}`);
    const match = data?.result?.addressMatches?.[0];
    if (!match?.coordinates) throw new Error('No address match found. Try a fuller street address or enter latitude/longitude manually.');
    return json(res, 200, {
      ok: true,
      latitude: match.coordinates.y,
      longitude: match.coordinates.x,
      matchedAddress: match.matchedAddress || address
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || 'Geocoding failed.' });
  }
}
