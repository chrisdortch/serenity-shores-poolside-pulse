(() => {
  const VERSION = '21';
  const TITLE = 'Lake123 - Poolside Pulse - v21';
  const DESCRIPTION = 'Lake123 Poolside Pulse v21: command iPhones control the speaker-connected Home iPhone with Manager gains, a very quiet Spotify bed, louder spoken announcements, Suno cues, and scheduled audio.';

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
