# Serenity Shores Poolside Pulse

Standalone Vercel-ready web app for poolside music, spoken announcements, and safety automation.

## Isolation rules

This project is intentionally separate from existing Serenity Shores / Lakeside Essentials projects. It does not import, modify, or reference any existing repo configuration, Vercel project ID, or production domain.

## Features

- Public dashboard with now-playing, queue, recent tracks, announcements, and safety status.
- Admin section with a dedicated **Playlist** tab for adding/updating the Suno playlist source and queue.
- Manual announcement composer with repeat count and repeat delay.
- Free browser text-to-speech via `speechSynthesis`.
- Weather automation using key-free public APIs:
  - National Weather Service active alerts for official tornado/severe thunderstorm warnings.
  - Open-Meteo current thunderstorm code detection as a lightning/thunderstorm signal.
- Safety mode pauses music, speaks guest instructions, speaks lifeguard instructions, starts a 30-minute timer, then resumes after clear.

## Important production warning

Free weather services are not equivalent to real-time strike-level lightning detection. Before relying on this for guest safety, connect a dedicated lightning data provider and implement authenticated admin access backed by a server/database.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Default admin passcode

`2468`

Change this before sharing publicly. The current passcode is front-end-only and is for prototype/demo use only.
