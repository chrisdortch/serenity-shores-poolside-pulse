(() => {
  const VERSION = '7.0';
  const TITLE = 'Serenity Shores Poolside Pulse V7';
  const DESCRIPTION = 'Serenity Shores Poolside Pulse V7: receiver-owned Spotify playback, durable command events, AI voice announcements, weather checks, and schedule control.';

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
