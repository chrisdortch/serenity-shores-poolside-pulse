(() => {
  const VERSION = '7.0';
  const TITLE = 'Serenity Shores Poolside Pulse V7';
  const DESCRIPTION = 'Serenity Shores Poolside Pulse V7: receiver-owned Spotify playback, durable command events, AI voice announcements, weather checks, and schedule control.';
  const LATEST_URL = '/?v=9-fresh-session&from=v7';

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

  function rescueOldRuntime() {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('legacy') === '1' || params.get('v') === '9-fresh-session') return;
      const banner = document.createElement('div');
      banner.textContent = 'Updating Poolside Pulse receiver to V9...';
      banner.style.cssText = 'position:fixed;z-index:99999;left:10px;right:10px;bottom:10px;padding:12px 14px;border-radius:12px;background:#101d35;color:white;font:800 15px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;box-shadow:0 12px 26px rgba(0,0,0,.2);';
      document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner), { once: true });
      setTimeout(() => location.replace(LATEST_URL), 700);
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', rewriteVersionText);
  setInterval(rewriteVersionText, 1000);
  rewriteVersionText();
  rescueOldRuntime();
})();
