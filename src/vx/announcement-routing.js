/**
 * Selects the one receiver that can actually play an announcement now.
 *
 * A visible Browser Receiver always wins because it is already holding the
 * live audio session and can pause/duck and restore its own music bed. Pushcut
 * is the fallback only when no Browser Receiver is online, except for the
 * explicit Pushcut diagnostic button.
 */
export function preferredAnnouncementTransport({
  browserReceiverOnline = false,
  pushcutReady = false,
  forcePushcut = false
} = {}) {
  if (forcePushcut) return pushcutReady ? 'pushcut' : 'unavailable';
  if (browserReceiverOnline) return 'browser';
  if (pushcutReady) return 'pushcut';
  return 'unavailable';
}
