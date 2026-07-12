# Serenity Shores Poolside Pulse vFinal

Poolside Pulse coordinates scheduled announcements, weather safety messages, Suno/direct music, and Spotify from one dedicated speaker receiver.

Automatic weather checks run every two minutes. Each request overlaps at least six minutes of NOAA GLM lightning data, and the lookback expands after an incomplete check so a single provider failure does not create a blind gap.

## Operating contract

- Exactly one speaker receiver owns audio. Phones and laptops in Remote Control mode only send commands to that receiver.
- Suno/direct audio runs through one Web Audio graph with an adjustable 0–100% music target (30% by default), voice fixed at 100%, and music ducked to no more than 6% while speech plays.
- Spotify is always confirmed paused before voice. A supported desktop receiver may report the selected music target only after the local SDK sets and re-reads that exact value; iPhone/iPad Spotify volume is never presented as software-controlled.
- Suno/direct and Spotify are mutually exclusive. Every play, resume, skip, stop, and scheduled handoff silences the other local source before the selected source can become audible.
- Receiver leases, expiring commands, revision-checked writes, and server-adjusted time prevent stale playback and split ownership.
- Scheduled items are recorded only after successful playback. Weather failures persist an explicit unknown state and never manufacture an all-clear.
- The receiver stops audio if durable cloud heartbeats are unavailable for a full lease.

For unattended scheduling, use an always-on desktop-class receiver connected to the speakers, keep the page visible, and keep the device plugged in.

## Start-up

1. Open vFinal on the device connected to the pool speakers.
2. Choose **Speaker Receiver**, then **Start Receiver**.
3. Use other devices in **Remote Control** mode.
4. Set the shared **Music volume** slider (30% by default). Prefer **Suno / Direct** when exact adjustable music and 100% announcements are required.
5. On an iPhone receiver, use **Volume Up** once to put the physical device at 100% before Suno/direct mixing. The **Volume Down** and **Volume Up** Shortcut buttons are manual helpers; iOS cannot run them invisibly during an unattended schedule.

## Required production configuration

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: mandatory durable state, receiver ownership, conflict control, and distributed login throttling.
- `POOL_SIDE_PIN`: mandatory four-digit numeric access code or 8–64 character production passphrase.
- `POOL_SIDE_SESSION_SECRET`: recommended dedicated signing secret; a configured server-side integration secret is used only as a fallback.
- `OPENAI_API_KEY`: optional natural announcement voice; device speech is the bounded fallback.
- Existing weather-provider variables remain server-side and optional; failures are shown as unknown rather than clear.

The receiver refuses to start unless live state reports durable KV sync. Do not use temporary server-memory mode for operations.

## Commands

```bash
npm install
npm run dev
npm run verify
```

Vercel settings: Vite framework, `npm install`, `npm run build`, output directory `dist`.

## Backup and isolation

The pre-vFinal V23 source is preserved at commit `e8b59e119398d180e2540791f54e09d63cdef9bb` and branch `codex/backup-v23-20260711`. The in-app archive page is informational and does not activate the old receiver.

This repository is standalone and must remain isolated from Lakeside Essentials, RollinD, Lifeguard Scheduler, Boat Rental, and every other Serenity Shores project.
