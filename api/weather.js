const THUNDERSTORM_CODES = new Set([95, 96, 99]);
const TORNADO_EVENTS = ['Tornado Warning', 'Tornado Emergency'];
const STORM_EVENTS = ['Severe Thunderstorm Warning', 'Special Weather Statement'];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function ringPoints(lat, lon, radiusMiles) {
  const radiusKm = radiusMiles * 1.609344;
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
  const points = [{ lat, lon, label: 'center' }];
  const R = 6371;
  const p1 = lat * Math.PI / 180;
  const l1 = lon * Math.PI / 180;
  for (const bearing of bearings) {
    const theta = bearing * Math.PI / 180;
    const d = radiusKm / R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(theta));
    const l2 = l1 + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    points.push({ lat: p2 * 180 / Math.PI, lon: l2 * 180 / Math.PI, label: `${bearing}°` });
  }
  return points;
}

async function getNwsAlerts(points) {
  const alerts = [];
  for (const point of points) {
    const url = `https://api.weather.gov/alerts/active?point=${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Serenity Shores Poolside Pulse (contact: chrisdortch@gmail.com)',
          'Accept': 'application/geo+json,application/json'
        }
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const feature of data.features || []) {
        const props = feature.properties || {};
        alerts.push({ event: props.event || '', headline: props.headline || '', description: props.description || '', instruction: props.instruction || '', point: point.label });
      }
    } catch {}
  }
  const seen = new Set();
  return alerts.filter(a => {
    const key = `${a.event}|${a.headline}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getOpenMeteoThunder(points) {
  const hits = [];
  for (const point of points) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', point.lat.toFixed(5));
    url.searchParams.set('longitude', point.lon.toFixed(5));
    url.searchParams.set('current', 'weather_code,wind_gusts_10m');
    url.searchParams.set('forecast_days', '1');
    try {
      const response = await fetch(url.toString());
      if (!response.ok) continue;
      const data = await response.json();
      const code = Number(data?.current?.weather_code);
      if (THUNDERSTORM_CODES.has(code)) hits.push({ point: point.label, code });
    } catch {}
  }
  return hits;
}

function classify(alerts, thunderHits) {
  const tornado = alerts.find(a => TORNADO_EVENTS.some(name => a.event.includes(name)));
  if (tornado) return { threat: true, threatType: 'Tornado', summary: `${tornado.event}: ${tornado.headline || tornado.description || 'NWS tornado alert near resort.'}` };
  const severe = alerts.find(a => STORM_EVENTS.some(name => a.event.includes(name)) && /lightning|thunderstorm|storm/i.test(`${a.headline} ${a.description} ${a.instruction}`));
  if (severe) return { threat: true, threatType: 'Lightning/Thunderstorm', summary: `${severe.event}: ${severe.headline || 'Thunderstorm/lightning-risk alert near resort.'}` };
  if (thunderHits.length) return { threat: true, threatType: 'Lightning/Thunderstorm', summary: `Thunderstorm weather code detected within radius at ${thunderHits.map(h => h.point).join(', ')}.` };
  return { threat: false, threatType: '', summary: alerts.length ? `${alerts.length} NWS alert(s), none requiring pool closure by current rules.` : 'No tornado or thunderstorm/lightning trigger detected in the monitored radius.' };
}

export default async function handler(req, res) {
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);
  const radiusMiles = Math.max(1, Math.min(25, Number(req.query?.radiusMiles) || 10));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { ok: false, error: 'Valid latitude and longitude are required.' });
  try {
    const points = ringPoints(lat, lon, radiusMiles);
    const [alerts, thunderHits] = await Promise.all([getNwsAlerts(points), getOpenMeteoThunder(points)]);
    const result = classify(alerts, thunderHits);
    return json(res, 200, { ok: true, radiusMiles, checkedPoints: points.length, alerts, thunderHits, ...result });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || 'Weather check failed.' });
  }
}
