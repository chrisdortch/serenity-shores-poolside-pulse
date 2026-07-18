import {
  DEFAULT_ANNOUNCEMENTS,
  SAFETY_EVENT_TTL_MS,
  evaluateWeather,
  safetyAnnouncementText
} from './core.js';

export function weatherConfigSnapshot(config = {}) {
  return {
    latitude: Number(config.latitude),
    longitude: Number(config.longitude),
    lightningRadiusMiles: Number(config.lightningRadiusMiles),
    lightningHoldMinutes: Number(config.lightningHoldMinutes),
    windGustMph: Number(config.windGustMph)
  };
}

export function sameWeatherConfig(left = {}, right = {}) {
  const a = weatherConfigSnapshot(left);
  const b = weatherConfigSnapshot(right);
  return Object.keys(a).every(key => Object.is(a[key], b[key]));
}

/**
 * Returns the concise status spoken only for a user-requested weather check
 * when no new safety announcement was generated. Automatic scans remain
 * silent unless they detect a new warning.
 */
export function manualWeatherStatusAnnouncement({ payload = null } = {}) {
  if (!payload || payload.ok === false) {
    return 'The weather check could not be completed. Please check the Remote screen before relying on the result.';
  }
  const threatType = String(payload.threatType || '').toLowerCase();
  if (payload.threat === true) {
    if (threatType.includes('tornado')) {
      return 'Weather check complete. A tornado warning is active for the configured pool area.';
    }
    if (threatType.includes('lightning')) {
      return 'Weather check complete. Lightning is active within the configured pool safety radius.';
    }
    if (threatType.includes('wind')) {
      return 'Weather check complete. Strong wind is active above the configured pool threshold.';
    }
    return 'Weather check complete. A configured weather safety trigger is active. Please check the Remote screen.';
  }
  const providerErrors = Array.isArray(payload.providerErrors) ? payload.providerErrors : [];
  const coverageIncomplete = payload.lightningCoverageKnown !== true
    || payload.tornadoCoverageKnown === false
    || payload.windCoverageKnown === false;
  if (providerErrors.length || coverageIncomplete) {
    return 'Weather check complete, but part of the weather data is unavailable. Please check the Remote screen before relying on the result.';
  }
  return 'Weather check complete. No lightning, tornado warning, or strong wind trigger was detected for the configured pool area.';
}

function stageBeforeAnnouncement(previousWeather, evaluatedWeather, announcementIds, now, config) {
  const previous = previousWeather || {};
  const staged = {
    ...evaluatedWeather,
    pendingAnnouncementIds: [...announcementIds],
    pendingAnnouncementAt: announcementIds.length ? now : 0,
    pendingAnnouncementConfig: announcementIds.length ? weatherConfigSnapshot(config) : null,
    pendingAnnouncementCommit: announcementIds.length ? { ...evaluatedWeather } : null
  };
  for (const id of announcementIds) {
    if (id === 'lightning') {
      staged.lastLightningKey = previous.lastLightningKey || '';
      staged.lastLightningAnnouncementAt = Number(previous.lastLightningAnnouncementAt || 0);
    } else if (id === 'lightning-clear') {
      staged.lightningActive = true;
      staged.lightningHoldUntil = Number(previous.lightningHoldUntil || 0);
    } else if (id === 'wind') {
      staged.lastWindAnnouncementAt = Number(previous.lastWindAnnouncementAt || 0);
    } else if (id === 'tornado') {
      staged.lastTornadoAnnouncementAt = Number(previous.lastTornadoAnnouncementAt || 0);
    }
  }
  return staged;
}

function pendingWeatherWarningFresh(weather, now) {
  const ids = (Array.isArray(weather?.pendingAnnouncementIds) ? weather.pendingAnnouncementIds : [])
    .filter(id => ['lightning', 'wind', 'tornado'].includes(id));
  if (!ids.length) return false;
  const pendingAt = Number(weather.pendingAnnouncementAt || 0);
  if (!pendingAt || pendingAt > now) return false;
  return ids.every(id => {
    if (id === 'lightning') {
      const committedHoldUntil = Number(weather.pendingAnnouncementCommit?.lightningHoldUntil || 0);
      const holdMinutes = Number(weather.pendingAnnouncementConfig?.lightningHoldMinutes || 30);
      const deadline = committedHoldUntil
        || (pendingAt + Math.max(5, Math.min(90, holdMinutes)) * 60_000);
      return now <= deadline;
    }
    return now - pendingAt <= SAFETY_EVENT_TTL_MS;
  });
}

export function preparePendingWeatherAnnouncement({
  weather = {},
  savedAnnouncements = [],
  config = {},
  now = Date.now()
} = {}) {
  if (!pendingWeatherWarningFresh(weather, now)) return null;
  const announcementIds = weather.pendingAnnouncementIds
    .filter(id => ['lightning', 'wind', 'tornado'].includes(id));
  const messageConfig = weather.pendingAnnouncementConfig || config;
  const items = announcementIds.map(id => {
    const saved = savedAnnouncements.find(item => item.id === id);
    const defaultAnnouncement = DEFAULT_ANNOUNCEMENTS.find(item => item.id === id);
    const text = safetyAnnouncementText(
      id,
      String(saved?.text || '').trim() || defaultAnnouncement?.text,
      messageConfig
    );
    if (!text) throw new Error(`Pending weather safety message ${id} is empty or missing.`);
    return { id, label: String(saved?.label || defaultAnnouncement?.label || id), text };
  });
  return {
    announcementIds,
    pendingAt: Number(weather.pendingAnnouncementAt || 0),
    label: `${items.map(item => item.label).join(' + ')} (durable retry)`,
    text: items.map(item => item.text.trim()).join(' '),
    committedWeather: {
      ...weather,
      ...(weather.pendingAnnouncementCommit && typeof weather.pendingAnnouncementCommit === 'object'
        ? weather.pendingAnnouncementCommit
        : {}),
      pendingAnnouncementIds: [],
      pendingAnnouncementAt: 0,
      pendingAnnouncementConfig: null,
      pendingAnnouncementCommit: null
    }
  };
}

/**
 * Builds the durable before/after state and the one combined urgent message
 * for a Remote-initiated weather scan when Pushcut owns the Receiver iPhone.
 */
export function prepareImmediateWeatherAnnouncement({
  previousWeather = {},
  payload = {},
  config = {},
  savedAnnouncements = [],
  now = Date.now()
} = {}) {
  const evaluated = evaluateWeather(previousWeather, payload, config, now);
  const announcementIds = evaluated.announcements.filter(id =>
    ['lightning', 'lightning-clear', 'wind', 'tornado'].includes(id)
  );
  const adjustedConfig = {
    ...config,
    lightningRadiusMiles: payload.lightningRadiusMiles ?? config.lightningRadiusMiles
  };
  const items = announcementIds.map(id => {
    const saved = savedAnnouncements.find(item => item.id === id);
    const defaultAnnouncement = DEFAULT_ANNOUNCEMENTS.find(item => item.id === id);
    const text = safetyAnnouncementText(
      id,
      String(saved?.text || '').trim() || defaultAnnouncement?.text,
      adjustedConfig
    );
    if (!text) throw new Error(`Weather safety message ${id} is empty or missing.`);
    return {
      id,
      label: String(saved?.label || id),
      text: String(text).trim()
    };
  });
  return {
    announcementIds,
    label: items.map(item => item.label).join(' + '),
    text: items.map(item => item.text).join(' '),
    stagedWeather: announcementIds.length
      ? stageBeforeAnnouncement(previousWeather, evaluated.weather, announcementIds, now, adjustedConfig)
      : {
          ...evaluated.weather,
          pendingAnnouncementIds: [],
          pendingAnnouncementAt: 0,
          pendingAnnouncementConfig: null,
          pendingAnnouncementCommit: null
        },
    completedWeather: {
      ...evaluated.weather,
      pendingAnnouncementIds: [],
      pendingAnnouncementAt: 0,
      pendingAnnouncementConfig: null,
      pendingAnnouncementCommit: null
    }
  };
}
