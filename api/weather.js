const THUNDERSTORM_CODES = new Set([95, 96, 99]);
const TORNADO_EVENTS = ['Tornado Warning', 'Tornado Emergency'];
const STORM_EVENTS = ['Severe Thunderstorm Warning', 'Special Weather Statement'];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function coord(value) {
  const n = Number(String(value ?? '').trim().replace(/[−–—]/g, '-'));
  return Number.isFinite(n) ? n : null;
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
  const errors = [];
  for (const point of points) {
    try {
      const url = new URL('https://api.weather.gov/alerts/active');
      url.searchParams.set('point', `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Serenity Shores Poolside Pulse (contact: chrisdortch@gmail.com)',
          'Accept': 'application/geo+json,application/json'
        }
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        errors.push(`NWS ${point.label}: HTTP ${response.status} ${text.slice(0, 120)}`);
        continue;
      }
      const data = await response.json();
      for (const feature of data.features || []) {
        const props = feature.properties || {};
        alerts.push({ event: props.event || '', headline: props.headline || '', description: props.description || '', instruction: props.instruction || '', point: point.label });
      }
    } catch (error) {
      errors.push(`NWS ${point.label}: ${error.message}`);
    }
  }
  const seen = new Set();
  return {
    alerts: alerts.filter(a => {
      const key = `${a.event}|${a.headline}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    errors
  };
}

async function getOpenMeteoSignals(points, windGustMph) {
  const thunderHits = [];
  const windHits = [];
  const errors = [];
  for (const point of points) {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', point.lat.toFixed(5));
      url.searchParams.set('longitude', point.lon.toFixed(5));
      url.searchParams.set('current', 'weather_code,wind_gusts_10m');
      url.searchParams.set('wind_speed_unit', 'mph');
      url.searchParams.set('forecast_days', '1');
      const response = await fetch(url.toString());
      if (!response.ok) {
        errors.push(`Open-Meteo ${point.label}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      const code = Number(data?.current?.weather_code);
      const gust = Number(data?.current?.wind_gusts_10m);
      if (THUNDERSTORM_CODES.has(code)) thunderHits.push({ point: point.label, code });
      if (Number.isFinite(gust) && gust >= windGustMph) windHits.push({ point: point.label, gustMph: Math.round(gust), thresholdMph: windGustMph });
    } catch (error) {
      errors.push(`Open-Meteo ${point.label}: ${error.message}`);
    }
  }
  return { thunderHits, windHits, errors };
}

function classify(alerts, thunderHits, windHits, providerErrors) {
  const tornado = alerts.find(a => TORNADO_EVENTS.some(name => a.event.includes(name)));
  if (tornado) return { threat: true, threatType: 'Tornado', summary: `${tornado.event}: ${tornado.headline || tornado.description || 'NWS tornado alert near resort.'}` };
  const severe = alerts.find(a => STORM_EVENTS.some(name => a.event.includes(name)) && /lightning|thunderstorm|storm/i.test(`${a.headline} ${a.description} ${a.instruction}`));
  if (severe) return { threat: true, threatType: 'Lightning/Thunderstorm', summary: `${severe.event}: ${severe.headline || 'Thunderstorm/lightning-risk alert near resort.'}` };
  if (thunderHits.length) return { threat: true, threatType: 'Lightning/Thunderstorm', summary: `Thunderstorm weather code detected within radius at ${thunderHits.map(h => h.point).join(', ')}.` };
  if (windHits.length) {
    const max = windHits.reduce((best, hit) => hit.gustMph > best.gustMph ? hit : best, windHits[0]);
    return { threat: true, threatType: 'Strong Wind', summary: `Strong wind gust detected within radius: ${max.gustMph} mph at ${max.point}.` };
  }
  if (alerts.length) return { threat: false, threatType: '', summary: `${alerts.length} NWS alert(s), none requiring pool closure by current rules.` };
  if (providerErrors.length) return { threat: false, threatType: '', summary: `No closure trigger detected. Some weather provider checks reported issues: ${providerErrors.slice(0, 2).join(' | ')}` };
  return { threat: false, threatType: '', summary: 'No tornado, thunderstorm/lightning, or strong-wind trigger detected in the monitored radius.' };
}

export default async function handler(req, res) {
  const lat = coord(req.query?.lat);
  const lon = coord(req.query?.lon);
  const radiusMiles = Math.max(1, Math.min(25, Number(req.query?.radiusMiles) || 10));
  const windGustMph = Math.max(15, Math.min(80, Number(req.query?.windGustMph) || 35));
  if (lat === null || lon === null) return json(res, 400, { ok: false, error: 'Valid latitude and longitude are required. Use decimal coordinates like 36.6337 and -93.4166.' });
  try {
    const points = ringPoints(lat, lon, radiusMiles);
    const [nws, meteo] = await Promise.all([getNwsAlerts(points), getOpenMeteoSignals(points, windGustMph)]);
    const providerErrors = [...nws.errors, ...meteo.errors];
    const result = classify(nws.alerts, meteo.thunderHits, meteo.windHits, providerErrors);
    return json(res, 200, { ok: true, radiusMiles, windGustMph, checkedPoints: points.length, alerts: nws.alerts, thunderHits: meteo.thunderHits, windHits: meteo.windHits, providerErrors, ...result });
  } catch (error) {
    return json(res, 200, { ok: true, threat: false, threatType: '', radiusMiles, windGustMph, checkedPoints: 0, alerts: [], thunderHits: [], windHits: [], providerErrors: [error.message], summary: `Weather check did not complete, but the app stayed online. Error: ${error.message || 'Unknown weather error.'}` });
  }
}
