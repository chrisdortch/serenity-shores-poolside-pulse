#!/usr/bin/env node

import { normalizeState } from '../src/vx/core.js';

export const DAILY_APPLE_PLAYLIST =
  'https://music.apple.com/us/playlist/pool-music-openai/pl.u-WabZvbaFRrzK3z1';

const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const WEDNESDAY = Object.freeze([3]);

const PARTY_SUNO = Object.freeze([
  ['01', 'Five-Minute Warning', 'https://suno.com/s/YPpNpDdD08t96sAr', 24],
  ['02', 'Welcome to the Party', 'https://suno.com/s/xuIHhhziNDHZMa6S', 138],
  ['03', 'Tonight’s Game Plan', 'https://suno.com/s/OjPgnjY5xBotTHUE', 42],
  ['04', 'Pick Your Partner and Meet Robert', 'https://suno.com/s/seuyfCCgEyZU1QAB', 36],
  ['05', 'Five Minutes to Game Time', 'https://suno.com/s/PlvoZMUdhYjWcmQU', 16],
  ['06', 'The Great Water-Balloon Toss', 'https://suno.com/s/jfv6CIvPyltjgRxc', 77],
  ['07', 'The Limbo Challenge', 'https://suno.com/s/F6Sw5sxww26PEobA', 54],
  ['08', 'Hula-Hoop Showdown', 'https://suno.com/s/GxpncBjVE2GyZktZ', 43],
  ['09', 'Free Ice Cream Celebration', 'https://suno.com/s/6urqUYNtYwFqHQYj', 28],
  ['10', 'Line Dancing in Ten Minutes', 'https://suno.com/s/S81fn02xFUnmhreV', 34],
  ['11', 'Open the Dance Floor', 'https://suno.com/s/mM1pfxvmgtiROkPQ', 36],
  ['12', 'Karaoke Is Calling', 'https://suno.com/s/xkQip46bYhsgn2K1', 45],
  ['13', 'Welcome to Karaoke', 'https://suno.com/s/jSEHXSZB2ipArwqE', 40]
]);

const PARTY_APPLE = Object.freeze({
  hot: ['Hot Hot Hot — Buster Poindexter & His Banshees of Blue', 'https://music.apple.com/us/song/hot-hot-hot/414710439', 250],
  limbo: ['Limbo Rock — Chubby Checker', 'https://music.apple.com/us/song/limbo-rock/1514045351', 145],
  wipeout: ['Wipe Out — The Surfaris', 'https://music.apple.com/us/song/wipe-out/1623617682', 135],
  icecream: ['Ice Cream Man — Van Halen', 'https://music.apple.com/us/song/ice-cream-man/976820706', 199],
  macarena: ['Macarena (Bayside Boys Remix) — Los del Río', 'https://music.apple.com/us/song/macarena-bayside-boys-remix/254532477', 222],
  ymca: ['Y.M.C.A. (Single Version) — Village People', 'https://music.apple.com/us/song/y-m-c-a-single-version/1440895662', 228],
  cha: ['Cha Cha Slide (Original Live Platinum Band Mix—Short Version) — DJ Casper', 'https://music.apple.com/us/song/cha-cha-slide-original-live-platinum-band-mix-short-version/1609526675', 217],
  church: ['Church Clap — KB featuring Lecrae', 'https://music.apple.com/us/song/church-clap-feat-lecrae/1533144132', 198],
  cotton: ['Cotton Eye Joe — Rednex', 'https://music.apple.com/us/song/cotton-eye-joe/255961201', 194],
  cupid: ['Cupid Shuffle — Cupid', 'https://music.apple.com/us/song/cupid-shuffle/1805114560', 232]
});

function announcementItem(id, label, time, announcementId, {
  days = ALL_DAYS,
  restoreMusicPercent = 30,
  protectedItem = false
} = {}) {
  return {
    id,
    label,
    enabled: true,
    protected: protectedItem,
    skippedDates: [],
    days: [...days],
    position: { time, order: 1 },
    action: {
      kind: 'announcement',
      announcementSource: 'saved',
      announcementId,
      sourceId: 'natural-voice',
      text: '',
      url: '',
      restoreMusicPercent
    },
    volume: { mode: 'global', percent: 100 },
    advance: { mode: 'complete', durationSeconds: 1 }
  };
}

function finitePartyAnnouncement(number, time, restoreMusicPercent, labelSuffix = '') {
  const source = PARTY_SUNO.find(item => item[0] === number);
  if (!source) throw new Error(`Party Suno cue ${number} is missing.`);
  return {
    id: `party-suno-${number}-x`,
    label: `${number} · ${source[1]}${labelSuffix}`,
    enabled: true,
    skippedDates: [],
    days: [...WEDNESDAY],
    position: { time, order: 1 },
    action: {
      kind: 'announcement',
      announcementSource: 'inline',
      announcementId: '',
      sourceId: `party-suno-${number}`,
      text: source[1],
      url: '',
      restoreMusicPercent
    },
    volume: { mode: 'global', percent: 100 },
    advance: { mode: 'complete', durationSeconds: source[3] }
  };
}

function musicItem(id, label, time, url, percent, days = WEDNESDAY, durationSeconds = 300) {
  return {
    id,
    label,
    enabled: true,
    skippedDates: [],
    days: [...days],
    position: { time, order: 1 },
    action: { kind: 'apple', announcementSource: '', announcementId: '', sourceId: '', text: '', url, restoreMusicPercent: null },
    volume: { mode: 'custom', percent },
    advance: { mode: 'manual', durationSeconds }
  };
}

function orderItem(item, order, advanceMode = item.advance?.mode || 'manual') {
  return {
    ...item,
    position: { ...item.position, order },
    advance: { ...item.advance, mode: advanceMode }
  };
}

function stopItem() {
  return {
    id: 'daily-quiet-hours-x',
    label: 'Pool Closed / Quiet Hours',
    enabled: true,
    protected: true,
    skippedDates: [],
    days: [...ALL_DAYS],
    position: { time: '22:00', order: 9 },
    action: { kind: 'stop', announcementSource: '', announcementId: '', sourceId: '', text: '', url: '', restoreMusicPercent: null },
    volume: { mode: 'global', percent: 0 },
    advance: { mode: 'complete', durationSeconds: 1 }
  };
}

function withOrders(items) {
  return items.map((item, index) => ({
    ...item,
    position: { ...item.position, order: index + 1 }
  }));
}

export function resortHubAnnouncementSources() {
  return PARTY_SUNO.map(([number, label, url, durationSeconds]) => ({
    id: `party-suno-${number}`,
    label: `${number} · ${label}`,
    kind: 'finite-audio',
    provider: 'suno',
    url,
    finite: true,
    durationSeconds,
    playbackSupport: 'supported',
    verification: 'verified',
    voice: '',
    instructions: '',
    note: 'Verified finite Party announcement clip.'
  }));
}

export function dailyResortSchedule() {
  return {
    id: 'daily-schedule',
    name: 'Daily Operations',
    mode: 'time',
    enabled: true,
    cancellable: false,
    cancelledDates: [],
    items: withOrders([
      announcementItem('daily-welcome-x', 'Morning Announcement', '10:00', 'welcome', { protectedItem: true }),
      musicItem('daily-pool-apple-x', 'Pool Music · Apple Playlist', '10:02', DAILY_APPLE_PLAYLIST, 30, ALL_DAYS),
      announcementItem('daily-no-glass-x', 'No Glass Reminder', '11:30', 'no-glass'),
      announcementItem('daily-owner-x', 'Owner Message', '12:30', 'owner'),
      announcementItem('daily-hydrate-x', 'Hydration Reminder', '13:30', 'hydrate'),
      announcementItem('daily-manager-x', 'Manager Message', '14:30', 'manager'),
      announcementItem('daily-closing-15-x', 'Closing in 15 Minutes', '21:45', 'closing-15', { protectedItem: true }),
      announcementItem('daily-closing-5-x', 'Closing in 5 Minutes', '21:55', 'closing-5', { protectedItem: true }),
      stopItem()
    ])
  };
}

export function wednesdayPartySchedule() {
  const apple = key => PARTY_APPLE[key];
  return {
    id: 'wednesday-party-schedule',
    name: 'Wednesday Party',
    mode: 'time',
    enabled: true,
    cancellable: true,
    cancelledDates: [],
    items: withOrders([
      finitePartyAnnouncement('01', '18:20', 30),
      finitePartyAnnouncement('03', '18:45', 30),
      finitePartyAnnouncement('04', '18:50', 30),
      finitePartyAnnouncement('05', '18:55', 30),
      finitePartyAnnouncement('06', '19:00', 30),
      musicItem('party-apple-hot-x', apple('hot')[0], '19:02', apple('hot')[1], 100, WEDNESDAY, apple('hot')[2]),
      finitePartyAnnouncement('10', '19:50', 100),
      finitePartyAnnouncement('11', '20:00', 100),
      musicItem('party-apple-macarena-x', apple('macarena')[0], '20:01', apple('macarena')[1], 100, WEDNESDAY, apple('macarena')[2]),
      musicItem('party-apple-ymca-x', apple('ymca')[0], '20:05', apple('ymca')[1], 100, WEDNESDAY, apple('ymca')[2]),
      musicItem('party-apple-cha-x', apple('cha')[0], '20:09', apple('cha')[1], 100, WEDNESDAY, apple('cha')[2]),
      musicItem('party-apple-church-x', apple('church')[0], '20:13', apple('church')[1], 100, WEDNESDAY, apple('church')[2]),
      musicItem('party-apple-cotton-x', apple('cotton')[0], '20:17', apple('cotton')[1], 100, WEDNESDAY, apple('cotton')[2]),
      finitePartyAnnouncement('12', '20:20', 100),
      musicItem('party-apple-cupid-x', apple('cupid')[0], '20:21', apple('cupid')[1], 100, WEDNESDAY, apple('cupid')[2]),
      finitePartyAnnouncement('13', '20:30', 100),
      musicItem('party-daily-restore-x', 'Resume Daily Pool Music', '20:31', DAILY_APPLE_PLAYLIST, 30)
    ])
  };
}

export function wednesdayPartyLiveCuesSchedule() {
  return {
    id: 'wednesday-party-live-cues',
    name: 'Wednesday Party Live Cues',
    mode: 'order',
    enabled: true,
    cancellable: false,
    cancelledDates: [],
    items: [
      orderItem(
        finitePartyAnnouncement('02', '18:25', 30, ' · HOLD until food line is ready'),
        1,
        'manual'
      ),
      orderItem(finitePartyAnnouncement('07', '19:15', 100, ' · after balloon toss'), 2, 'complete'),
      orderItem(musicItem('party-apple-limbo-x', PARTY_APPLE.limbo[0], '19:16', PARTY_APPLE.limbo[1], 100, WEDNESDAY, PARTY_APPLE.limbo[2]), 3, 'manual'),
      orderItem(finitePartyAnnouncement('08', '19:25', 100, ' · after limbo'), 4, 'complete'),
      orderItem(musicItem('party-apple-wipeout-x', PARTY_APPLE.wipeout[0], '19:26', PARTY_APPLE.wipeout[1], 100, WEDNESDAY, PARTY_APPLE.wipeout[2]), 5, 'manual'),
      orderItem(finitePartyAnnouncement('09', '19:35', 100, ' · HOLD until lifeguard shack is ready'), 6, 'complete'),
      orderItem(musicItem('party-apple-icecream-x', PARTY_APPLE.icecream[0], '19:36', PARTY_APPLE.icecream[1], 100, WEDNESDAY, PARTY_APPLE.icecream[2]), 7, 'manual')
    ]
  };
}

export function prepareResortHubState(inputState, now = Date.now()) {
  const current = normalizeState(inputState, now);
  const replacementIds = new Set([
    'daily-schedule',
    'wednesday-party-schedule',
    'wednesday-party-live-cues'
  ]);
  const retainedSchedules = (current.schedules || []).filter(schedule => (
    !replacementIds.has(schedule.id)
    && !['daily', 'daily operations', 'party', 'wednesday party'].includes(String(schedule.name || '').trim().toLowerCase())
  )).map(schedule => (
    String(schedule.mode || 'time').toLowerCase() === 'time'
      ? { ...schedule, enabled: false }
      : schedule
  ));
  const retainedSources = (current.announcementSources || [])
    .filter(source => !String(source.id || '').startsWith('party-suno-'));
  const receiverOffline = current.receiver?.status !== 'online';
  return normalizeState({
    ...current,
    config: {
      ...current.config,
      receiverMode: 'browser',
      announcementTransport: 'email-wake',
      musicProvider: 'apple',
      appleUrl: DAILY_APPLE_PLAYLIST,
      musicLevel: 30,
      voiceLevel: 100,
      duckLevel: 0
    },
    playback: receiverOffline
      ? {
          ...current.playback,
          provider: 'apple',
          intent: 'paused',
          label: 'Daily Pool Music',
          sourceUrl: DAILY_APPLE_PLAYLIST,
          musicLevelPercent: 30,
          volumeMode: 'custom',
          updatedAt: now,
          unavailableReason: 'Start Speaker Receiver to begin the Daily Apple Music bed.'
        }
      : current.playback,
    announcementSources: [
      ...retainedSources,
      ...resortHubAnnouncementSources()
    ],
    schedules: [
      dailyResortSchedule(),
      wednesdayPartySchedule(),
      wednesdayPartyLiveCuesSchedule(),
      ...retainedSchedules
    ],
    // Time schedules are concurrent overlays. Keep the readiness-gated and
    // crowd-timed Party cues as the active manual queue so the Remote's Play
    // Next button is immediately useful without weakening Daily automation.
    activeScheduleId: 'wednesday-party-live-cues',
    sequenceRuns: {
      ...(current.sequenceRuns || {}),
      'daily-schedule': undefined,
      'wednesday-party-schedule': undefined,
      'wednesday-party-live-cues': undefined
    },
    activityLog: [
      {
        id: `log-resort-hub-${now}`,
        kind: 'settings',
        title: 'Resort media-hub schedules installed',
        detail: 'Daily Operations and Wednesday Party run together; readiness-gated game cues use the live Play Next queue; Automatic Receiver is authoritative and Pushcut is retired from normal operation.',
        createdAt: now
      },
      ...(current.activityLog || [])
    ]
  }, now);
}

function baseUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:') throw new Error('POOL_SIDE_TARGET_URL must use HTTPS.');
  return parsed.origin;
}

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map(value => String(value).split(';', 1)[0]).filter(Boolean).join('; ');
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) throw new Error(`${label} failed: ${body?.error || `HTTP ${response.status}`}`);
  return body;
}

export async function applyResortHubDeployment({ targetUrl, accessCode, fetchImpl = globalThis.fetch }) {
  const origin = baseUrl(targetUrl);
  const common = { Accept: 'application/json', Origin: origin, Referer: `${origin}/` };
  const login = await fetchImpl(`${origin}/api/session?v=x`, {
    method: 'POST',
    headers: { ...common, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ pin: String(accessCode || '').trim() })
  });
  await responseJson(login, 'Version X login');
  const cookie = cookieFrom(login);
  if (!cookie) throw new Error('Version X login did not return a session cookie.');
  const read = await fetchImpl(`${origin}/api/state-x?v=x`, {
    headers: { ...common, Cookie: cookie },
    cache: 'no-store'
  });
  const existing = await responseJson(read, 'Version X state read');
  const prepared = prepareResortHubState(existing.state);
  const write = await fetchImpl(`${origin}/api/state-x?v=x`, {
    method: 'POST',
    headers: { ...common, Cookie: cookie, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      version: 'x',
      expectedRevision: Number(existing.state?.revision || 0),
      state: prepared
    })
  });
  const saved = await responseJson(write, 'Version X state write');
  const sync = await fetchImpl(`${origin}/api/email-wake-schedule-x?v=x`, {
    method: 'POST',
    headers: { ...common, Cookie: cookie, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ enabled: true, expectedRevision: Number(saved.state?.revision || 0) })
  });
  const synchronized = await responseJson(sync, 'Automatic schedule sync');
  return {
    revision: Number(saved.state?.revision || 0),
    schedules: saved.state?.schedules?.map(schedule => ({
      id: schedule.id,
      name: schedule.name,
      mode: schedule.mode,
      enabled: schedule.enabled,
      items: schedule.items?.length || 0
    })) || [],
    announcementSources: saved.state?.announcementSources?.length || 0,
    scheduleSyncedThrough: Number(synchronized.horizonEnd || 0),
    scheduledOccurrences: Number(synchronized.scheduledCount || 0)
  };
}

const invokedDirectly = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (invokedDirectly) {
  applyResortHubDeployment({
    targetUrl: process.env.POOL_SIDE_TARGET_URL,
    accessCode: process.env.POOL_SIDE_ACCESS_CODE
  }).then(result => {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  }).catch(error => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
