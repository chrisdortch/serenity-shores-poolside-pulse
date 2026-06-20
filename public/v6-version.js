(() => {
  const VERSION = '6.2';
  const TITLE = 'Serenity Shores Poolside Pulse V6.2';

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
      ensureMeta('description', 'Serenity Shores Poolside Pulse V6.2: durable receiver announcements, Spotify ducking, live weather checks, and command-to-receiver control.');

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (!node.nodeValue) return;
        node.nodeValue = node.nodeValue
          .replaceAll('V6.1', 'V6.2')
          .replaceAll('Version 6.1', 'Version 6.2')
          .replaceAll('V6.0', 'V6.2')
          .replaceAll('Version 6.0', 'Version 6.2')
          .replaceAll('V5.10', 'V6.2')
          .replaceAll('Version 5.10', 'Version 6.2')
          .replaceAll('V5.9', 'V6.2')
          .replaceAll('Version 5.9', 'Version 6.2')
          .replaceAll('V5.0', 'V6.2')
          .replaceAll('Version 5.0', 'Version 6.2')
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
  document.addEventListener('DOMContentLoaded', rewriteVersionText);
  setInterval(rewriteVersionText, 500);
  rewriteVersionText();
})();
