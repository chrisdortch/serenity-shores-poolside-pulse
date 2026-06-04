(() => {
  const VERSION = '4.8';
  const TITLE = `Serenity Shores Poolside Pulse V${VERSION}`;

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
      ensureMeta('description', `Serenity Shores Poolside Pulse V${VERSION}: iPhone and Safari compatible resort music, spoken announcements, schedules, birthdays, and weather-aware pool safety.`);

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (!node.nodeValue) return;
        node.nodeValue = node.nodeValue
          .replaceAll('V4.7', 'V4.8')
          .replaceAll('Version 4.7', 'Version 4.8')
          .replaceAll('V4.6', 'V4.8')
          .replaceAll('Version 4.6', 'Version 4.8')
          .replaceAll('V4.5', 'V4.8')
          .replaceAll('Version 4.5', 'Version 4.8')
          .replaceAll('V4.4', 'V4.8')
          .replaceAll('Version 4.4', 'Version 4.8')
          .replaceAll('V4.2', 'V4.8')
          .replaceAll('Version 4.2', 'Version 4.8')
          .replaceAll('V4.0', 'V4.8')
          .replaceAll('Version 4.0', 'Version 4.8');
      });
    } catch {}
  }

  window.__poolsidePulseVersion = VERSION;
  document.addEventListener('DOMContentLoaded', rewriteVersionText);
  setInterval(rewriteVersionText, 500);
  rewriteVersionText();
})();
