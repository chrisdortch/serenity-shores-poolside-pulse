(() => {
  const PATCH_VERSION = '4.2';
  const postedKey = 'poolside-pulse-local-posted-announcement-v42';
  const tracked = new Set();
  let duckDepth = 0;

  function note(text) {
    try {
      const box = document.getElementById('feedbackBox');
      if (box && !box.textContent.includes(text)) box.innerHTML += '<br><b>V4.2:</b> ' + text;
    } catch {}
  }

  function isAnnouncementSource(src) {
    src = String(src || '');
    return src.startsWith('blob:') || src.includes('/api/tts');
  }

  function isPlaying(media) {
    try { return media && !media.paused && !media.ended && media.readyState > 0 && String(media.currentSrc || media.src || ''); } catch { return false; }
  }

  function remember(media) {
    if (media) tracked.add(media);
  }

  function fade(media, target, ms) {
    try {
      if (media.__pulseOriginalVolume === undefined) media.__pulseOriginalVolume = Number.isFinite(media.volume) ? media.volume : 0.95;
      const start = Number.isFinite(media.volume) ? media.volume : 0.95;
      const steps = 16;
      let step = 0;
      clearInterval(media.__pulseFadeTimer);
      media.__pulseFadeTimer = setInterval(() => {
        step += 1;
        try { media.volume = Math.max(0, Math.min(1, start + (target - start) * (step / steps))); } catch {}
        if (step >= steps) clearInterval(media.__pulseFadeTimer);
      }, Math.max(20, ms / steps));
    } catch {}
  }

  function musicPlayers(except) {
    return [...tracked].filter(media => {
      const src = String(media.currentSrc || media.src || '');
      return media !== except && !isAnnouncementSource(src);
    });
  }

  function duck(except) {
    duckDepth += 1;
    musicPlayers(except).forEach(media => {
      if (isPlaying(media)) fade(media, 0, 850);
    });
    note('music fading to zero before announcement');
  }

  function unduck() {
    duckDepth = Math.max(0, duckDepth - 1);
    if (duckDepth > 0) return;
    setTimeout(() => {
      musicPlayers(null).forEach(media => {
        if (!isPlaying(media)) return;
        const original = Number.isFinite(media.__pulseOriginalVolume) ? media.__pulseOriginalVolume : 0.95;
        fade(media, original, 1050);
        media.__pulseOriginalVolume = undefined;
      });
      note('music fading back up after announcement');
    }, 180);
  }

  const playOriginal = HTMLMediaElement.prototype.play;
  if (!HTMLMediaElement.prototype.__pulsePlayV42) {
    HTMLMediaElement.prototype.play = function patchedPlay(...args) {
      remember(this);
      const src = String(this.currentSrc || this.src || '');
      const announcement = isAnnouncementSource(src);
      if (!announcement) return playOriginal.apply(this, args);
      duck(this);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let finished = false;
          const finish = () => { if (finished) return; finished = true; unduck(); };
          try {
            this.addEventListener('ended', finish, { once: true });
            this.addEventListener('pause', finish, { once: true });
            this.addEventListener('error', finish, { once: true });
            setTimeout(finish, 180000);
            Promise.resolve(playOriginal.apply(this, args)).then(resolve).catch(error => { finish(); reject(error); });
          } catch (error) {
            finish();
            reject(error);
          }
        }, 850);
      });
    };
    HTMLMediaElement.prototype.__pulsePlayV42 = true;
  }

  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDescriptor && srcDescriptor.set && !HTMLMediaElement.prototype.__pulseSrcV42) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDescriptor.enumerable,
      get: srcDescriptor.get,
      set(value) {
        try {
          const current = new URL(srcDescriptor.get.call(this), location.href).href;
          const next = new URL(String(value), location.href).href;
          if (current && next && current === next) return;
        } catch {}
        return srcDescriptor.set.call(this, value);
      }
    });
    HTMLMediaElement.prototype.__pulseSrcV42 = true;
  }

  if (window.speechSynthesis && !window.speechSynthesis.__pulseSpeakV42) {
    const speakOriginal = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = utterance => {
      duck(null);
      let finished = false;
      const finish = () => { if (finished) return; finished = true; unduck(); };
      try {
        utterance.addEventListener('end', finish, { once: true });
        utterance.addEventListener('error', finish, { once: true });
      } catch {
        const oldEnd = utterance.onend;
        const oldErr = utterance.onerror;
        utterance.onend = e => { if (oldEnd) oldEnd(e); finish(); };
        utterance.onerror = e => { if (oldErr) oldErr(e); finish(); };
      }
      setTimeout(finish, 180000);
      setTimeout(() => speakOriginal(utterance), 850);
    };
    window.speechSynthesis.__pulseSpeakV42 = true;
  }

  const fetchOriginal = window.fetch.bind(window);
  if (!window.__pulseFetchV42) {
    window.fetch = async (...args) => {
      const request = args[0];
      const init = args[1] || {};
      const url = typeof request === 'string' ? request : (request && request.url) || '';
      const method = String(init.method || (request && request.method) || 'GET').toUpperCase();
      if (url.includes('/api/state') && method === 'POST') {
        try {
          const body = typeof init.body === 'string' ? init.body : '';
          const parsed = JSON.parse(body || '{}');
          const id = parsed?.state?.announcement?.id;
          if (id) localStorage.setItem(postedKey, JSON.stringify({ id, at: Date.now() }));
        } catch {}
      }
      const response = await fetchOriginal(...args);
      if (url.includes('/api/state') && method === 'GET') {
        try {
          const data = await response.clone().json();
          const local = JSON.parse(localStorage.getItem(postedKey) || '{}');
          if (local.id && data?.state?.announcement?.id === local.id && Date.now() - Number(local.at || 0) < 240000) {
            data.state.announcement = null;
            return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
          }
        } catch {}
      }
      return response;
    };
    window.__pulseFetchV42 = true;
  }

  function versionRewrite() {
    try {
      document.title = 'Serenity Shores Poolside Pulse V4.2';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (node.nodeValue) node.nodeValue = node.nodeValue.replaceAll('V4.0', 'V4.2').replaceAll('V4.1', 'V4.2').replaceAll('Version 4.0', 'Version 4.2').replaceAll('Version 4.1', 'Version 4.2');
      });
    } catch {}
  }

  window.__pulsePatchVersion = PATCH_VERSION;
  document.addEventListener('DOMContentLoaded', versionRewrite);
  setInterval(versionRewrite, 600);
})();
