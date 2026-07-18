# Poolside Pulse X Receiver Shortcuts

These are dedicated Version X Receiver shortcuts. They do not rename, edit, or
replace the original `Poolside Pulse Announcement`, `Volume Up`, or
`Volume Down` shortcuts.

## Receiver behavior

`Poolside Pulse X Announcement` performs this exact sequence:

1. Read the one-time Version X request.
2. Download the natural-voice announcement.
3. Pause the native music bed and wait one second.
4. Set the Receiver's media volume to 100%.
5. Play the announcement and wait for it to finish.
6. Fetch the latest manager-selected music level.
7. Restore that level and resume the music.
8. POST the signed `poolside-pulse-x-audio-v4` completion receipt.

`Poolside Pulse X Recovery` applies immediate manager volume changes and
recovers a timed announcement only when the signed server response says
recovery is still required. Music resumes only when the request explicitly
sets `resumeMusic` to true.

Neither shortcut contains a Pushcut key, Apple key, Spotify secret, permanent
audio URL, or permanent receipt URL.

## Rebuild and sign

The editable source is written in [Cherri](https://cherrilang.org/). Compile
without `--derive-uuids`; nested Shortcut conditionals require separate group
identifiers.

```sh
cherri tools/shortcuts-x/poolside-pulse-x-announcement.cherri --skip-sign
cherri tools/shortcuts-x/poolside-pulse-x-recovery.cherri --skip-sign
node tools/shortcuts-x/verify-shortcuts.mjs
shortcuts sign --mode anyone --input "tools/shortcuts-x/Poolside Pulse X Announcement_unsigned.shortcut" --output public/shortcuts/poolside-pulse-x-announcement.shortcut
shortcuts sign --mode anyone --input "tools/shortcuts-x/Poolside Pulse X Recovery_unsigned.shortcut" --output public/shortcuts/poolside-pulse-x-recovery.shortcut
```

Apple's `shortcuts sign --mode anyone` service validated and signed the
committed installers. After signing again, update `manifest.json` with the new
SHA-256 hashes and run the verifier once more.
