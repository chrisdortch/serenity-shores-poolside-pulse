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

- Version 20.4 keeps the command-phone/Home-receiver model, caps Spotify and Suno music controls at 33%, defaults music to 15%, restores a loud adjustable Web Audio voice gain up to 1200%, and keeps Spotify pause/restore during announcements.
- Version 20.3 keeps the command-phone/Home-receiver model, defaults Spotify bed music to 33%, plays voice at true 100% receiver volume, pauses/restores Spotify for announcements, and refuses to fall back to unrelated active Spotify devices.
- Version 20.2 keeps Spotify music at 33%, changes Spotify during voice to 0%, sends Spotify volume slider changes live without re-rendering the slider during drag, and verifies the requested Spotify volume against the audible Spotify device before reporting success.
- Version 20.1 keeps the V20 receiver model and fixes the live audio balance: all music defaults to 33%, voice announcements default to the maximum 600% boost, Spotify ducks to 33% for spoken voice, Spotify pauses during Suno foreground tracks, stale Spotify play retries are stopped, and scheduled Suno cues can be stopped from Command or Home while they are playing.
- Version 17 rolls forward from the V9 receiver model: one speaker phone stays on Home, Command devices only send controls, music starts at 45%, the deleted default Suno playlist is removed, and weather closure triggers require verified lightning/NWS closure alerts instead of Open-Meteo thunderstorm-code-only hits.
- Version 13 unifies Spotify and Suno music volume into one receiver-wide Music Volume command, lowers inherited loud music defaults, primes iPhone receiver audio for seamless Suno switching, simplifies the schedule item editor, and improves iPhone/laptop layout behavior.
- Version 12 adds Lake123 branding, a receiver on/off switch independent of Home/Command view, clickable receiver repair notices, stronger button pressed states, receiver-wide volume commands, and denser collapsible party cue cards.
- Version 11 adds the Weekly Poolside Party Command Page, editable party cues, Gabe/Callie/manager/safety voice profiles, manual checkpoints, Spotify/Suno/custom-audio cue support, import/export JSON, and a mode switch that suspends normal pool automation only while the party schedule is active. Weather monitoring and safety announcements remain active.

## Vercel settings

- Framework: Vite
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

## Prototype warning

This version uses browser localStorage and a front-end-only admin passcode. Before using it for public safety-critical operations, replace the prototype passcode with real authentication and connect a dedicated weather/lightning provider.
