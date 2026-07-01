(() => {
  const VERSION = '20.14';
  const TITLE = 'Lake123 - Poolside Pulse - v20.14';
  const DESCRIPTION = 'Lake123 Poolside Pulse v20.14: command iPhones control the speaker-connected Home iPhone, music stays in the 15-33% range, spoken commands pause music, play through a clear PA voice path, then restore music.';

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
