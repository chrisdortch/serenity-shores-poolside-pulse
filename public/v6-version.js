(() => {
  const VERSION = '6.3';
  const TITLE = 'Serenity Shores Poolside Pulse V6.3';
  const LATEST_URL = '/?v=9-fresh-session&from=v6';

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
      ensureMeta('description', 'Serenity Shores Poolside Pulse V6.3: durable receiver announcements, Spotify ducking, live weather checks, and command-to-receiver control.');

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (!node.nodeValue) return;
        node.nodeValue = node.nodeValue
          .replaceAll('V6.2', 'V6.3')
          .replaceAll('Version 6.2', 'Version 6.3')
          .replaceAll('V6.1', 'V6.3')
          .replaceAll('Version 6.1', 'Version 6.3')
          .replaceAll('V6.0', 'V6.3')
          .replaceAll('Version 6.0', 'Version 6.3')
          .replaceAll('V5.10', 'V6.3')
          .replaceAll('Version 5.10', 'Version 6.3')
          .replaceAll('V5.9', 'V6.3')
          .replaceAll('Version 5.9', 'Version 6.3')
          .replaceAll('V5.0', 'V6.3')
          .replaceAll('Version 5.0', 'Version 6.3')
          .replaceAll('V4.9', 'V6')
          .replaceAll('Version 4.9', 'Version 6')
          .replaceAll('V4.8', 'V6')
          .replaceAll('Version 4.8', 'Version 6')
          .replaceAll('V4.7', 'V6')
          .replaceAll('Version 4.7', 'Version 6')
          .replaceAll('V4.6', 'V6')
          .replaceAll('Version 4.6', 'Version 6')
          .replaceAll('V4.5', 'V6')
          .replaceAll('Version 4.5', 'Version 6');
      });
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
  setInterval(rewriteVersionText, 500);
  rewriteVersionText();
  rescueOldRuntime();
})();
