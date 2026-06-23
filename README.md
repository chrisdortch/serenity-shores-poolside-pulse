# Serenity Shores Poolside Pulse

A standalone Vite web app for Serenity Shores poolside music, weather safety automation, spoken announcements, and playlist administration.

## Isolation guarantee

This project is intentionally standalone. It does not import from, depend on, or modify:

- `serenity-stores`
- `Lifeguards`
- `first`
- `lakesideessentials.com`
- `serenityshores.com`

Deploy it as its own Vercel project.

## Admin playlist section

Open Admin with passcode `2468`, then use **Playlist → Add / Update Playlist** to:

- update playlist name
- store the Suno playlist URL
- add individual tracks
- bulk import tracks
- add direct audio URLs where available
- reorder or delete tracks

## Commands

```bash
npm install
npm run dev
npm run build
```

## Version Notes

- Version 11 adds the Weekly Poolside Party Command Page, editable party cues, Gabe/Callie/manager/safety voice profiles, manual checkpoints, Spotify/Suno/custom-audio cue support, import/export JSON, and a mode switch that suspends normal pool automation only while the party schedule is active. Weather monitoring and safety announcements remain active.

## Vercel settings

- Framework: Vite
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

## Prototype warning

This version uses browser localStorage and a front-end-only admin passcode. Before using it for public safety-critical operations, replace the prototype passcode with real authentication and connect a dedicated weather/lightning provider.
