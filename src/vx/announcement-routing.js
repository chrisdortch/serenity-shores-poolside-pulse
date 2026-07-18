/**
 * Selects the one receiver that can actually play an announcement now.
 *
 * Receiver mode is a shared, durable handoff. It prevents the short browser
 * lease left behind while iOS switches from Safari to Pushcut from stealing a
 * command that only Pushcut can receive. An explicit Browser or Pushcut
 * selection is authoritative. Only legacy state with no saved mode infers the
 * available receiver, preferring a live Browser before ready Pushcut.
 */
export function preferredAnnouncementTransport({
  receiverMode,
  browserReceiverOnline = false,
  pushcutReady = false,
  forcePushcut = false
} = {}) {
  if (forcePushcut) return pushcutReady ? 'pushcut' : 'unavailable';
  if (receiverMode === 'pushcut') return pushcutReady ? 'pushcut' : 'unavailable';
  if (receiverMode === 'browser') return browserReceiverOnline ? 'browser' : 'unavailable';
  if (browserReceiverOnline) return 'browser';
  if (pushcutReady) return 'pushcut';
  return 'unavailable';
}
