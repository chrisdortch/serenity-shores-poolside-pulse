(() => {
  const VERSION = '5.10';
  const TITLE = 'Serenity Shores Poolside Pulse V5.10';

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
      ensureMeta('description', 'Serenity Shores Poolside Pulse V5.10: hardened remote commands, stable announcements, fast weather checks, Spotify duck-and-restore, and receiver-safe music control.');

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (!node.nodeValue) return;
        node.nodeValue = node.nodeValue
          .replaceAll('V5.9', 'V5.10')
          .replaceAll('Version 5.9', 'Version 5.10')
          .replaceAll('V5.0', 'V5.10')
          .replaceAll('Version 5.0', 'Version 5.10')
          .replaceAll('V4.9', 'V5.10')
          .replaceAll('Version 4.9', 'Version 5.10')
          .replaceAll('V4.8', 'V5.10')
          .replaceAll('Version 4.8', 'Version 5.10')
          .replaceAll('V4.7', 'V5.10')
          .replaceAll('Version 4.7', 'Version 5.10')
          .replaceAll('V4.6', 'V5.10')
          .replaceAll('Version 4.6', 'Version 5.10')
          .replaceAll('V4.5', 'V5.10')
          .replaceAll('Version 4.5', 'Version 5.10');
      });
    } catch {}
  }

  window.__poolsidePulseVersion = VERSION;
  document.addEventListener('DOMContentLoaded', rewriteVersionText);
  setInterval(rewriteVersionText, 500);
  rewriteVersionText();
})();
