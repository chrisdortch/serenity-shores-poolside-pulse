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
- Plays Apple Music URLs inside the same open, signed-in MusicKit receiver page.
- Provides independent 0–100 global music and spoken-announcement controls.
- Lets every scheduled music or announcement item inherit its global level or use a custom 0–100 level.
- Fully silences Suno/direct music during speech, then continues the same track.
- Fades and pauses Apple Music before Suno or speech. Apple Music and the interruption do not overlap. It resumes only after the interruption finishes and only if it was playing beforehand.
- Shows Apple Music volume as exact only when a desktop-class receiver sets and reads back the same MusicKit value. iPhone/iPad is honestly labeled pause-only because browser code cannot control physical output volume there.
- Requires one open, plugged-in desktop receiver for unattended schedules. A suspended browser cannot be treated as a reliable audio appliance.

Apple Music playback also requires an active Apple Music subscription on the Apple Account authorized on the speaker receiver. Apple Developer Program membership alone does not supply playback entitlement.

## Three things needed from the owner

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), create a **Media ID** named `Poolside Pulse X`, use a unique identifier such as `com.serenityshores.poolsidepulsex`, and enable MusicKit.
2. In [Keys](https://developer.apple.com/account/resources/authkeys/list), create a dedicated **Media Services key** connected to that Media ID. Send the Team ID, Key ID, Media ID, and the local filesystem path where the downloaded `.p8` file is saved. Do not paste the private key into chat and do not place it in this repository.
3. Send the exact `https://music.apple.com/...` song/album/playlist URLs to use and confirm the receiver Apple Account has an active Apple Music subscription.

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
APPLE_MUSIC_ALLOWED_ORIGINS=https://serenity-shores-poolside-pulse.vercel.app
```

`APPLE_MUSIC_PRIVATE_KEY` is the secret PEM content from the dedicated `.p8` key. Configure it only as a protected server environment variable. `APPLE_MUSIC_ALLOWED_ORIGINS` is a comma-separated allowlist and must include each exact preview/production origin that will request a developer token.

Also supported:

- `OPENAI_API_KEY` for the natural announcement voice; bounded device speech is the fallback.
- `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` as an optional weather supplement.

Production requires durable KV, a dedicated session secret, and a valid access code. The receiver refuses to claim operational ownership without durable synchronization.

## Local verification

```bash
npm install
npm run dev
npm run verify
```

Vercel settings remain Vite framework, `npm install`, `npm run build`, output directory `dist`.

## Apple operating and policy boundary

MusicKit playback starts only after the receiver operator explicitly authorizes Apple Music and taps the receiver activation control. Standard Play, Pause, Next, and Stop controls remain visible. Version X does not extract or store the Music User Token.

The safe default is non-overlapping playback: Apple Music is paused before a spoken announcement or Suno source. Apple’s terms can restrict synchronizing Apple Music content with other content, so overlap ducking stays disabled unless Apple gives written approval for this exact use. The property operator remains responsible for the public/commercial performance rights for all music played at the pool.

References: [MusicKit](https://developer.apple.com/musickit/), [MusicKit user authorization](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit), [developer tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#apple-sites-and-services), and the [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).
