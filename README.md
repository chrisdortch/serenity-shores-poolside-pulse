# Serenity Shores Poolside Pulse — Version X

Version X supports Suno/direct audio, Apple Music, and Spotify music beds while preserving spoken announcements, weather safety checks, receiver leases, stale-command protection, and Time/Order schedules.

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
- Plays Spotify URLs through an isolated Version X PKCE receiver after the exact Version X redirect URI is registered.
- Generates natural resort-style announcement audio on the server and delivers it to the Receiver through one-time signed URLs.
- Supports short, downloadable Suno/direct announcement clips in Browser and Pushcut modes only when their actual media duration is no longer than 45 seconds.
- On the two-iPhone Pushcut path, uses a dynamic Shortcut contract: music follows the shared 0–100 slider, reaches 0% during speech, every announcement plays at 100%, and the same music is restored to the slider target only after playback completes.
- Provides one 0–100 music control. Announcement volume is fixed at 100% for live, saved, weather, safety, and scheduled speech.
- Lets scheduled music inherit the shared music level or use a custom 0–100 level. Scheduled announcements are always 100%.
- Fully silences Suno/direct music during speech, then continues the same track.
- Fades and pauses Apple Music before Suno or speech. Apple Music and the interruption do not overlap. It resumes only after the interruption finishes and only if it was playing beforehand.
- With the Mac receiver app, sets Music.app volume from 0–100 and reads the value back after every manager or schedule change. The app confirms Music.app is silent before spoken audio and restores the requested music target afterward.
- iPhone/iPad Apple Music remains honestly labeled physical-volume compatibility because Apple does not let a web page control protected media output volume there.
- Supports foreground schedules on an iPhone receiver. A suspended iPhone browser cannot be treated as an unattended audio appliance; hiding the page intentionally stops audio and stops lease renewal so cloud ownership expires safely.
- Runs mixed Browser schedules containing Natural Voice, short Suno/direct announcements, Suno/direct music, Apple Music, and Spotify. Time schedules fire at their Central Time positions; Order schedules follow their configured advance gates.
- Sends every manual Weather Check to the active receiver immediately. A failed safety announcement remains durable and is replayed before the next scan; a location or threshold change during a scan triggers a fresh request instead of committing stale weather.

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

- `OPENAI_API_KEY` for the required natural announcement voice. If generation is unavailable, Version X reports a failure and does not fall back to computer speech.
- `PUSHCUT_API_KEY_X` for the Version X Receiver automation.
- `PUSHCUT_PUBLIC_BASE_URL_X=https://poolside-pulse-x.vercel.app` so signed Receiver links always use the stable Version X alias.
- `PUSHCUT_RECOVERY_SHORTCUT_X=Volume Down` when the recovery Shortcut uses a non-default name.
- `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` as an optional weather supplement.

Production requires durable KV, a dedicated session secret, and a valid access code. The receiver refuses to claim operational ownership without durable synchronization.

## Recommended exact-volume operation

Use the dedicated Mac receiver for Apple Music, Suno/direct audio, spoken announcements, and schedules. Use the same Version X URL from any phone, tablet, or computer for commands.

1. Build once with `native/PoolsidePulseXMusicReceiver/scripts/build-app.sh`, then open `native/PoolsidePulseXMusicReceiver/dist/Poolside Pulse X Music Receiver.app`.
2. In macOS **Control Center → Sound**, choose the pool speaker as the Mac system output. Do not select a Music.app-only AirPlay destination because Music.app and announcement audio must share the same output.
3. In the receiver app, enter `7900`, tap **Start Receiver**, then **Allow Music.app Control / Connect Music.app Receiver**. Click **Allow** on the one-time macOS Automation prompt. Music.app must be signed in to the active Apple Music subscription.
4. On any command device, open [Poolside Pulse X](https://poolside-pulse-x.vercel.app/#command), enter `7900`, and choose **Remote Control**. The music slider sets the shared music target; all announcements are fixed at 100%.

Leave the Mac receiver app open. It prevents idle system sleep while running and silences Music.app if the window closes, the web receiver crashes, its page fails, or the app quits. Closing the last receiver window quits the app.

The checked-in build script creates a personal, ad-hoc signed app for this Mac. Set `POOLSIDE_CODE_SIGN_IDENTITY` to a Developer ID Application certificate when a stable notarized distribution build is needed for other Macs.

## Two-iPhone operating modes

Use two separate iPhones:

Choose one Receiver mode at a time. iOS cannot keep both Version X’s Browser Receiver and Pushcut’s Automation Server in the foreground.

### A. Browser Receiver mode

Use this for app-controlled Suno/direct, Apple Music, or Spotify playback and browser-owned schedules.

1. **Receiver iPhone:** connect it to the speakers and power, turn off Low Power Mode, set **Settings → Display & Brightness → Auto-Lock → Never**, and keep Version X visible. Choose **Speaker Receiver**, prepare the selected provider, then tap **Start Receiver** and its Connect action.
2. **Command iPhone:** use Version X in **Remote Control** mode.

The Receiver page shows Apple Music and Spotify setup separately; Spotify login is available before receiver ownership, and its Connect step becomes available after **Start Receiver**. Do not switch apps, lock, or hide Version X. It intentionally stops every audio path and releases cloud ownership when an iPhone Browser Receiver leaves the foreground. Pushcut announcements are not available while Pushcut is backgrounded.

### B. Pushcut announcement mode

Use this for dependable remote natural-voice or short finite-audio announcements over a background-capable music session. Music follows the Remote slider; announcements are fixed at 100%.

1. **Receiver iPhone:** use **Stop Receiver & Prepare Pushcut**. Version X first re-arms timed Pushcut announcements; it does not expose the Pushcut deep link while Browser Receiver still owns the schedule. Start the music directly in the Apple Music, Spotify, or background-capable Suno app—not in Version X.
2. Return to **Pushcut → Server → Ready For Requests** and leave Pushcut foreground.
3. **Command iPhone:** open Version X in **Remote Control**, move the Music slider to the desired target and choose **Apply Music _M_% Now**, then use **Speak Now**, a saved announcement, or a synced timed announcement.

While Pushcut is foreground, Version X cannot choose or skip the native music source from the Command phone. It can set the iPhone media output to the music slider target. The announcement Shortcut pauses the current media session, applies 100%, plays the downloaded natural voice or finite clip to completion, fetches and restores the latest shared music target, then resumes that session.

On an iPhone receiver, the dynamic Shortcut sets the shared iPhone media volume used by Apple Music, Spotify, or a background-capable Suno player. iOS does not report the resulting physical loudness of the iPhone or connected Bluetooth speaker back to Version X, so the app reports the requested target and signed Shortcut completion rather than claiming a physical measurement. Generated speech is required; Version X reports a failure instead of silently falling back to computer speech.

### One-time Pushcut announcement Shortcut update

On the Receiver iPhone, edit **Poolside Pulse Announcement**:

1. Keep **Get Dictionary from Shortcut Input** first; this is the original Dictionary.
2. Get `audioUrl` from the original Dictionary → **Get Contents of URL** (GET) → **Set Variable** named `Announcement Audio`.
3. Add **Pause on iPhone** → **Wait 1 second**.
4. Get `announcementLevel` from the original Dictionary → **Set Media Volume** to that Dictionary Value. Version X sends `1`, meaning 100%.
5. Add **Play Sound** with Sound File set to `Announcement Audio`. Keep it before every restore action so Shortcuts waits for playback to finish.
6. After **Play Sound** finishes: get `restoreUrl` from the original Dictionary → **Get Contents of URL** (GET) → **Set Variable** named `Restore Target`.
7. Get `musicLevel` from `Restore Target` → **Set Media Volume** to that value → **Play on iPhone**.
8. Get `receiptUrl` from the original Dictionary → **Get Contents of URL**. Set Method **POST**, Request Body **JSON**, and add `status`=`completed`, `receiverContract`=`poolside-pulse-x-audio-v3`, `volumeRestored`=true, `restoredMusicPercent`=`musicPercent` from `Restore Target`, and `musicResumed`=true.
9. Open **Volume Down** and replace its fixed 30% action:
   - **Get Dictionary from Shortcut Input** and keep it as the original Dictionary.
   - Get `recoveryUrl`. If it has a value: **Get Contents of URL** (GET), get `shouldRecover`, and stop the Shortcut when it is false. Use those URL contents as the Recovery Dictionary. Otherwise use the original Dictionary as the Recovery Dictionary.
   - Get `musicLevel` from the Recovery Dictionary → **Set Media Volume** to that value.
   - Get `resumeMusic` from the Recovery Dictionary. If it is true, add **Play on iPhone** inside that If. Manual slider changes send false; an incomplete timed announcement sends true.
10. Return to Pushcut → Server → **Ready For Requests**, then use **Run Verified Receiver Test** in Version X.

The signed receipt proves that the Shortcut reached its final step after playing the downloaded audio and running its recovery actions. It is not a microphone or physical-volume measurement.

Timed Pushcut announcements require Automation Server Extended and are synchronized as a rolling window of up to 29 days whenever Remote Control opens or the active Time schedule changes. Starting Browser Receiver cancels those delayed Pushcut copies before Browser scheduling begins; **Stop Receiver & Prepare Pushcut** re-arms them before opening Pushcut. Pushcut must stay on **Ready For Requests**. Pushcut mode schedules announcements only; a mixed music-and-announcement schedule requires the visible Browser Receiver (or the Poolside Pulse X Music Receiver Mac app).

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
