(() => {
  const VERSION = '20.1';
  const TITLE = 'Lake123 - Poolside Pulse - v20.1';
  const DESCRIPTION = 'Lake123 Poolside Pulse v20.1: music defaults to one-third announcement volume, Spotify ducks for voice, pauses for Suno, stale Spotify play retries are stopped, cancellable scheduled Suno cues, schedules, and weather safety holds.';

  function ensureMeta(name, value) {
    let tag = document.querySelector(`meta[name="${name}"]`);
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', name);
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', value);
  }

  function rewriteVersionText() {
    try {
      document.title = TITLE;
      document.documentElement.dataset.poolsideVersion = VERSION;
      const root = document.getElementById('app');
      if (root) root.dataset.version = VERSION;
      ensureMeta('app-version', VERSION);
      ensureMeta('description', DESCRIPTION);
    } catch {}
  }

  window.__poolsidePulseVersion = VERSION;
  document.addEventListener('DOMContentLoaded', rewriteVersionText);
  setInterval(rewriteVersionText, 1000);
  rewriteVersionText();
})();
