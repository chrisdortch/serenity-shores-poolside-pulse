(() => {
  const VERSION = '4.2';
  const postedKey = 'poolside-pulse-local-posted-announcement';
  const tracked = new Set();
  let ducking = 0;

  function now() { return Date.now(); }
  function shouldTrack(a) { try { return a && a.tagName !== 'VIDEO'; } catch { return true; } }
  function isPlaying(a) { try { return a && !a.paused && !a.ended && a.readyState > 0 && String(a.src || a.currentSrc || ''); } catch { return false; } }
  function isAnnouncementAudio(a) { const src = String(a?.src || a?.currentSrc || ''); return src.startsWith('blob:') || src.includes('/api/tts'); }
  function fade(a, target, ms = 650) {
    try {
      if (a.__pulseOriginalVolume === undefined) a.__pulseOriginalVolume = Number.isFinite(a.volume) ? a.volume : 0.95;
      const start = Number.isFinite(a.volume) ? a.volume : 0.95;
      const steps = 14;
      let step = 0;
      clearInterval(a.__pulseFadeTimer);
      a.__pulseFadeTimer = setInterval(() => {
        step += 1;
        try { a.volume = Math.max(0, Math.min(1, start + (target - start) * (step / steps))); } catch {}
        if (step >= steps) clearInterval(a.__pulseFadeTimer);
      }, Math.max(20, ms / steps));
    } catch {}
  }
  function musicAudios(except) { return [...tracked].filter(a => a !== except && !isAnnouncementAudio(a) && shouldTrack(a)); }
  function duck(except) {
    ducking += 1;
    musicAudios(except).forEach(a => { if (isPlaying(a)) fade(a, 0, 700); });
    note('Audio: music fading to zero for announcement.');
  }
  function unduck() {
    ducking = Math.max(0, ducking - 1);
    if (ducking > 0) return;
    setTimeout(() => {
      musicAudios(null).forEach(a => {
        const target = Number.isFinite(a.__pulseOriginalVolume) ? a.__pulseOriginalVolume : 0.95;
        if (isPlaying(a)) fade(a, target, 900);
        a.__pulseOriginalVolume = undefined;
      });
      note('Audio: announcement finished; music fading back up.');
    }, 150);
  }
  function note(text) {
    try {
      const box = document.getElementById('feedbackBox');
      if (box && !box.textContent.includes(text)) box.innerHTML += '<br><b>V4.2:</b> ' + text;
    } catch {}
  }

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDesc && srcDesc.set && !HTMLMediaElement.prototype.__pulseSrcPatched) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get: srcDesc.get,
      set(value) {
        try {
          const current = srcDesc.get.call(this);
          if (current && value && String(current) === String(value)) return;
        } catch {}
        return srcDesc.set.call(this, value);
      }
    });
    HTMLMediaElement.prototype.__pulseSrcPatched = true;
  }

  const OriginalAudio = window.Audio;
  function PatchedAudio(...args) {
    const a = new OriginalAudio(...args);
    tracked.add(a);
    const originalPlay = a.play.bind(a);
    a.play = (...playArgs) => {
      const announcement = isAnnouncementAudio(a);
      if (announcement) duck(a);
      const result = originalPlay(...playArgs);
      if (announcement) {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; unduck(); };
        a.addEventListener('ended', finish, { once: true });
        a.addEventListener('pause', finish, { once: true });
        a.addEventListener('error', finish, { once: true });
        setTimeout(finish, 180000);
      }
      return result;
    };
    return a;
  }
  PatchedAudio.prototype = OriginalAudio.prototype;
  window.Audio = PatchedAudio;

  if (window.speechSynthesis) {
    const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = utterance => {
      duck(null);
      let finished = false;
      const finish = () => { if (finished) return; finished = true; unduck(); };
      try {
        utterance.addEventListener('end', finish, { once: true });
        utterance.addEventListener('error', finish, { once: true });
      } catch {
        const oldEnd = utterance.onend;
        utterance.onend = e => { if (oldEnd) oldEnd(e); finish(); };
        const oldError = utterance.onerror;
        utterance.onerror = e => { if (oldError) oldError(e); finish(); };
      }
      setTimeout(finish, 180000);
      return originalSpeak(utterance);
    };
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const request = args[0];
    const url = typeof request === 'string' ? request : (request && request.url) || '';
    const init = args[1] || {};
    const method = String(init.method || (request && request.method) || 'GET').toUpperCase();
    if (url.includes('/api/state') && method === 'POST') {
      try {
        const body = typeof init.body === 'string' ? init.body : '';
        const parsed = JSON.parse(body || '{}');
        const id = parsed?.state?.announcement?.id;
        if (id) localStorage.setItem(postedKey, JSON.stringify({ id, at: now() }));
      } catch {}
    }
    const res = await originalFetch(...args);
    if (url.includes('/api/state') && method === 'GET') {
      try {
        const clone = res.clone();
        const data = await clone.json();
        const local = JSON.parse(localStorage.getItem(postedKey) || '{}');
        if (local.id && data?.state?.announcement?.id === local.id && now() - Number(local.at || 0) < 240000) {
          data.state.announcement = null;
          return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
      } catch {}
    }
    return res;
  };

  function rewriteVersionText() {
    try {
      document.title = 'Serenity Shores Poolside Pulse V4.2';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n => {
        if (n.nodeValue && /V4\.0|Version 4\.0|Poolside Pulse · V4\.0/.test(n.nodeValue)) {
          n.nodeValue = n.nodeValue.replaceAll('V4.0', 'V4.2').replaceAll('Version 4.0', 'Version 4.2');
        }
      });
    } catch {}
  }
  setInterval(rewriteVersionText, 700);
  document.addEventListener('DOMContentLoaded', rewriteVersionText);
})();
