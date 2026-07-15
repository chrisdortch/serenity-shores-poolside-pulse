# Serenity Shores Poolside Pulse — Version X

Version X replaces the Spotify path with Apple Music while preserving the proven Suno/direct mixer, spoken announcements, weather safety checks, receiver leases, stale-command protection, and Time/Order schedules.

It is isolated from the current V30 app:

- Branch: `codex/version-x-apple-music-suno`
- V30 backup tag: `poolside-pulse-v30-backup-20260714`
- Browser keys: `poolside-pulse-vx-*`
- Session cookie/signing context: Version X only
- Durable state endpoint: `/api/state-x?v=x`
- Durable state key: Version X only; it never reads or writes the V30 `final` key

No other Serenity Shores repository, Vercel project, database namespace, domain, or secret is used by this work.

## What Version X does

- Plays Suno shares/playlists and direct HTTPS audio through the receiver-owned Web Audio mixer.
- Plays Apple Music URLs through either the compatibility MusicKit web receiver or the recommended Poolside Pulse X Music Receiver Mac app.
- Provides independent 0–100 global Suno/direct-music and spoken-announcement controls.
- Lets every scheduled Suno/direct music or announcement item inherit its global level or use a custom 0–100 level.
- Fully silences Suno/direct music during speech, then continues the same track.
- Fades and pauses Apple Music before Suno or speech. Apple Music and the interruption do not overlap. It resumes only after the interruption finishes and only if it was playing beforehand.
- With the Mac receiver app, sets Music.app volume from 0–100 and reads the value back after every manager or schedule change. The app confirms Music.app is silent before spoken audio and restores the requested music target afterward.
- iPhone/iPad Apple Music remains honestly labeled physical-volume compatibility because Apple does not let a web page control protected media output volume there.
- Supports foreground schedules on an iPhone receiver. A suspended iPhone browser cannot be treated as an unattended audio appliance; hiding the page intentionally stops audio and stops lease renewal so cloud ownership expires safely.

Apple Music playback also requires an active Apple Music subscription on the Apple Account authorized on the speaker receiver. Apple Developer Program membership alone does not supply playback entitlement.

## Owner setup status

The dedicated Apple configuration is ready: Team ID `HHX689967A`, Key ID `8G28BYBZT2`, and Media ID `media.com.serenityshores.poolsidepulsex`. The `.p8` private key stays outside this repository and is used only as a protected server environment variable.

The remaining owner inputs are the exact `https://music.apple.com/...` song, album, or playlist URLs to save and an active Apple Music subscription in Music.app on the receiver Mac.

Apple’s detailed setup reference is [Create a media identifier and private key](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key). Poolside Pulse generates short-lived MusicKit developer tokens on the server; the `.p8` private key is never sent to the browser.

## Required server configuration

```dotenv
POOL_SIDE_PIN=
POOL_SIDE_SESSION_SECRET=
KV_REST_API_URL=
KV_REST_API_TOKEN=

APPLE_MUSIC_TEAM_ID=
APPLE_MUSIC_KEY_ID=
APPLE_MUSIC_MEDIA_ID=
APPLE_MUSIC_PRIVATE_KEY=
APPLE_MUSIC_ALLOWED_ORIGINS=https://poolside-pulse-x.vercel.app
```

`APPLE_MUSIC_PRIVATE_KEY` is the secret PEM content from the dedicated `.p8` key. Configure it only as a protected server environment variable. `APPLE_MUSIC_ALLOWED_ORIGINS` is a comma-separated allowlist and must include each exact preview/production origin that will request a developer token.

Also supported:

- `OPENAI_API_KEY` for the natural announcement voice; bounded device speech is the fallback.
- `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` as an optional weather supplement.

Production requires durable KV, a dedicated session secret, and a valid access code. The receiver refuses to claim operational ownership without durable synchronization.

## Recommended exact-volume operation

Use the dedicated Mac receiver for Apple Music, Suno/direct audio, spoken announcements, and schedules. Use the same Version X URL from any phone, tablet, or computer for commands.

1. Build once with `native/PoolsidePulseXMusicReceiver/scripts/build-app.sh`, then open `native/PoolsidePulseXMusicReceiver/dist/Poolside Pulse X Music Receiver.app`.
2. In macOS **Control Center → Sound**, choose the pool speaker as the Mac system output. Do not select a Music.app-only AirPlay destination because Music.app and announcement audio must share the same output.
3. In the receiver app, enter `7900`, tap **Start Receiver**, then **Allow Music.app Control / Connect Music.app Receiver**. Click **Allow** on the one-time macOS Automation prompt. Music.app must be signed in to the active Apple Music subscription.
4. On any command device, open [Poolside Pulse X](https://poolside-pulse-x.vercel.app/#command), enter `7900`, and choose **Remote Control**. The music and voice sliders apply to live commands and schedules.

Leave the Mac receiver app open. It prevents idle system sleep while running and silences Music.app if the window closes, the web receiver crashes, its page fails, or the app quits. Closing the last receiver window quits the app.

The checked-in build script creates a personal, ad-hoc signed app for this Mac. Set `POOLSIDE_CODE_SIGN_IDENTITY` to a Developer ID Application certificate when a stable notarized distribution build is needed for other Macs.

## Two-iPhone compatibility operation

Use two separate iPhones:

1. **Receiver iPhone:** connect it to the pool speakers and power, turn off Low Power Mode, set **Settings → Display & Brightness → Auto-Lock → Never**, and keep the Version X receiver page visible in Safari or its Home Screen web app. Choose **Speaker Receiver**, tap **Prepare Apple Music**, then tap **Authorize Apple Music**. After Apple accepts the account, tap **Start Receiver**, followed by **Connect Apple Music Receiver**.
2. **Command iPhone:** open Version X in Remote Control mode and send live or scheduled Apple Music, Suno, and announcement commands from this second phone.

Do not switch apps, lock, or hide the receiver page during a schedule. Version X fails closed when the iPhone receiver leaves the foreground: it stops its audio paths immediately, stops renewing cloud ownership so the 45-second lease expires, and requires fresh Start/Connect taps when reopened.

On an iPhone receiver, Apple Music playback level is set with the receiver iPhone or connected speaker's physical volume controls. MusicKit for the web cannot set or verify that physical output level, so Version X does not claim that Apple Music live or scheduled percentages were applied. Suno/direct audio and generated announcement audio remain adjustable from 0–100 in Version X. If generated speech is unavailable and iPhone device speech is used as a fallback, its percentage is a requested target rather than verified speaker loudness.

For genuinely unattended schedules and exact Apple Music volume, use the Poolside Pulse X Music Receiver Mac app; a foreground iPhone browser page is not an unattended service.

## Local verification

```bash
npm install
npm run dev
npm run verify
native/PoolsidePulseXMusicReceiver/scripts/build-app.sh
```

Vercel settings remain Vite framework, `npm install`, `npm run build`, output directory `dist`.

## Apple operating and policy boundary

MusicKit playback starts only after the receiver operator explicitly authorizes Apple Music and taps the receiver activation control. Standard Play, Pause, Next, and Stop controls remain visible. Version X does not extract or store the Music User Token.

Apple’s current U.S. Apple Media Services Terms limit the services and content to personal, noncommercial use and do not grant commercial, promotional, or copyright-owner rights. Do not use Apple Music through Version X for guest, rental, HOA, hospitality, business, or other public playback unless Apple and the relevant rights holders or licensing organizations confirm the exact use is authorized. Version X is a technical implementation, not a grant of music-performance rights.

The safe technical default is non-overlapping playback: Apple Music is paused before a spoken announcement or Suno source. Overlap ducking stays disabled unless Apple gives written approval for this exact use. The property operator remains responsible for the public/commercial performance rights for every music source played at the pool.

References: [MusicKit](https://developer.apple.com/musickit/), [MusicKit user authorization](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit), [developer tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens), [Apple Media Services Terms](https://www.apple.com/legal/internet-services/itunes/us/terms.html), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#apple-sites-and-services), and the [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).
