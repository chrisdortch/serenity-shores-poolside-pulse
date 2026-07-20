# Poolside Pulse X Receiver Shortcuts

These are dedicated Version X Receiver shortcuts. They do not rename, edit, or
replace the original `Poolside Pulse Announcement`, `Volume Up`, or
`Volume Down` shortcuts.

## Receiver behavior

`Poolside Pulse X Automatic Receiver` is the preferred single-shortcut
Receiver. One iOS Email personal automation runs it when the app sends a wake
email; Pushcut does not need to be open. The wake email contains no command,
audio, access code, or Receiver credential. The Shortcut claims the next
authorized command from Version X and performs this sequence:

1. Download the complete announcement while music remains at its selected
   level.
2. Authorize that exact, attempt-bound execution; a stale or expired attempt
   stops before changing the Receiver.
3. Set media volume to 0%, pause the current Now Playing source, and wait one
   second.
4. Set media volume to 100% and play the downloaded announcement to completion.
5. Set media volume to 0% before resuming Now Playing.
6. Resume the current source, wait one second, apply the command's safe
   fallback level, and then restore the latest
   manager-selected music level.
7. GET the signed, attempt-bound completion URL. The server derives and
   validates the expected restore target from the durable receipt, avoiding a
   fragile iOS-generated JSON body after playback.

If two Remotes send at nearly the same time, the server grants one playback
lease and a busy automation stops immediately. The active Shortcut handles one
command, then its signed completion receipt releases the lease and sends a new
drain email for the next queued command. This keeps each background automation
short. A reclaimed attempt repairs the music bed before retrying. After three
incomplete announcement attempts, a fourth recovery-only attempt resumes music
at the latest selected level without replaying the announcement. If that
recovery run is interrupted, later wakes remain recovery-only with a bounded
backoff until the server receives signed restoration proof; the command is
never silently declared safe or replayed.

The first manual run asks for a six-digit, one-time pairing code and stores only
the resulting revocable Receiver token in the user's iCloud Shortcuts folder.
Its register and claim requests use the permanent
`https://poolside-pulse-x-receiver.vercel.app` Receiver API alias so a branch
deployment URL can expire without breaking the installed automation.

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
cherri tools/shortcuts-x/poolside-pulse-x-automatic-receiver.cherri --skip-sign
node tools/shortcuts-x/verify-shortcuts.mjs
shortcuts sign --mode anyone --input "tools/shortcuts-x/Poolside Pulse X Announcement_unsigned.shortcut" --output public/shortcuts/poolside-pulse-x-announcement.shortcut
shortcuts sign --mode anyone --input "tools/shortcuts-x/Poolside Pulse X Recovery_unsigned.shortcut" --output public/shortcuts/poolside-pulse-x-recovery.shortcut
shortcuts sign --mode anyone --input "tools/shortcuts-x/Poolside Pulse X Automatic Receiver_unsigned.shortcut" --output public/shortcuts/poolside-pulse-x-automatic-receiver.shortcut
```

Apple's `shortcuts sign --mode anyone` service validated and signed the
committed installers. After signing again, update `manifest.json` with the new
SHA-256 hashes and run the verifier once more.
