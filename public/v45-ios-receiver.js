(() => {
  const PATCH_VERSION = '4.6';
  const tracked = new Set();
  const ducked = new Map();
  let annAudio = null;
  let unlockAudio = null;
  let unlocked = false;
  let unlocking = false;
  let duckDepth = 0;
  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';

  function isAnnouncementSrc(src) {
    src = String(src || '');
    return src.startsWith('blob:') || src.includes('/api/tts');
  }
  function getSrc(media) { try { return String(media.currentSrc || media.src || ''); } catch { return ''; } }
  function isPlaying(media) { try { return media && !media.paused && !media.ended && media.readyState > 0 && getSrc(media); } catch { return false; } }
  function sameUrl(a, b) { try { return new URL(a, location.href).href === new URL(b, location.href).href; } catch { return String(a || '') === String(b || ''); } }
  function note(text) {
    try {
      window.__pulseV46Status = text;
      const box = document.getElementById('feedbackBox');
      if (box && !box.textContent.includes(text)) box.innerHTML += '<br><b>V4.6:</b> ' + text;
    } catch {}
  }
  function makeHiddenAudio() {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.playsInline = true;
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    try { (document.body || document.documentElement).appendChild(a); } catch {}
    tracked.add(a);
    return a;
  }
  function getAnnAudio() { if (!annAudio) annAudio = makeHiddenAudio(); return annAudio; }
  function getUnlockAudio() { if (!unlockAudio) unlockAudio = makeHiddenAudio(); return unlockAudio; }
  function fade(media, target, ms = 700) {
    try {
      if (media.__pulseOriginalVolume === undefined) media.__pulseOriginalVolume = Number.isFinite(media.volume) ? media.volume : 0.95;
      const start = Number.isFinite(media.volume) ? media.volume : 0.95;
      const steps = 14;
      let i = 0;
      clearInterval(media.__pulseFadeTimer);
      media.__pulseFadeTimer = setInterval(() => {
        i += 1;
        try { media.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps))); } catch {}
        if (i >= steps) clearInterval(media.__pulseFadeTimer);
      }, Math.max(20, ms / steps));
    } catch {}
  }
  function musicPlayers(except) { return [...tracked].filter(media => media !== except && media !== getUnlockAudio() && !isAnnouncementSrc(getSrc(media))); }
  function snapshot(media) {
    try {
      const src = getSrc(media);
      if (!src) return;
      ducked.set(media, {
        src,
        time: Number.isFinite(media.currentTime) ? media.currentTime : 0,
        volume: Number.isFinite(media.__pulseOriginalVolume) ? media.__pulseOriginalVolume : (Number.isFinite(media.volume) ? Math.max(media.volume, 0.95) : 0.95),
        wasPlaying: isPlaying(media) || !media.paused
      });
    } catch {}
  }
  function duck(except) {
    duckDepth += 1;
    musicPlayers(except).forEach(media => {
      if (isPlaying(media)) {
        snapshot(media);
        fade(media, 0, 850);
      }
    });
    note('music fading to zero before announcement');
  }
  function restoreMedia(media, snap) {
    return new Promise(resolve => {
      (async () => {
        try {
          const currentSrc = getSrc(media);
          if (snap.src && currentSrc && !sameUrl(currentSrc, snap.src)) return resolve();
          if (!currentSrc && snap.src) media.src = snap.src;
          const currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
          if (snap.time > 1 && currentTime < Math.max(0, snap.time - 1.25)) {
            try { media.currentTime = snap.time; } catch {}
          }
          if ((media.paused || media.ended) && snap.wasPlaying) {
            note('music had been paused/interrupted by announcement; resuming same track');
            try { await media.play(); } catch (e) { note('music resume was blocked: ' + (e && e.message ? e.message : e)); }
          }
          if (!media.paused || isPlaying(media)) {
            fade(media, snap.volume || 0.95, 1000);
          }
          media.__pulseOriginalVolume = undefined;
        } catch (e) {
          note('music restore error: ' + (e && e.message ? e.message : e));
        }
        resolve();
      })();
    });
  }
  function unduck() {
    duckDepth = Math.max(0, duckDepth - 1);
    if (duckDepth > 0) return;
    const saved = [...ducked.entries()];
    ducked.clear();
    setTimeout(async () => {
      for (const [media, snap] of saved) await restoreMedia(media, snap);
      note('announcement finished; receiver music restored');
    }, 150);
  }
  async function unlockReceiverAudio(reason = 'receiver activation tap') {
    if (unlocked || unlocking) return unlocked;
    unlocking = true;
    try {
      for (const a of [getUnlockAudio(), getAnnAudio()]) {
        a.muted = false;
        a.volume = 1;
        a.src = SILENT_WAV;
        a.load();
        await a.play();
        a.pause();
        try { a.currentTime = 0; } catch {}
      }
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          window.__pulseAudioContext = window.__pulseAudioContext || new AudioContext();
          if (window.__pulseAudioContext.state !== 'running') await window.__pulseAudioContext.resume();
        }
      } catch {}
      unlocked = true;
      note('iPhone receiver audio unlocked for remote announcements by ' + reason + '.');
    } catch (e) {
      note('iPhone announcement audio still blocked: ' + (e && e.message ? e.message : e) + '. Tap Activate Sound / Play Station on this iPhone, then send announcement again.');
    } finally { unlocking = false; }
    return unlocked;
  }

  const NativeAudio = window.Audio;
  function PatchedAudio(src) {
    if (isAnnouncementSrc(src)) {
      const a = getAnnAudio();
      if (src && a.src !== src) a.src = src;
      a.muted = false;
      a.volume = 1;
      return a;
    }
    const a = src !== undefined ? new NativeAudio(src) : new NativeAudio();
    a.playsInline = true;
    try { a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', ''); } catch {}
    tracked.add(a);
    return a;
  }
  PatchedAudio.prototype = NativeAudio.prototype;
  window.Audio = PatchedAudio;

  const nativePlay = HTMLMediaElement.prototype.play;
  if (!HTMLMediaElement.prototype.__pulseV46Play) {
    HTMLMediaElement.prototype.play = function(...args) {
      tracked.add(this);
      const announcement = isAnnouncementSrc(getSrc(this));
      if (!announcement) {
        unlockReceiverAudio('Home sound activation').catch(() => {});
        return nativePlay.apply(this, args);
      }
      duck(this);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let finished = false;
          const finish = () => { if (finished) return; finished = true; unduck(); };
          try {
            this.playsInline = true;
            this.setAttribute('playsinline', '');
            this.setAttribute('webkit-playsinline', '');
            this.addEventListener('ended', finish, { once: true });
            this.addEventListener('pause', finish, { once: true });
            this.addEventListener('error', finish, { once: true });
            setTimeout(finish, 180000);
            Promise.resolve(nativePlay.apply(this, args)).then(resolve).catch(err => {
              finish();
              note('announcement play blocked: ' + (err && err.message ? err.message : err) + '. Re-tap Activate Sound / Play Station on this receiver.');
              reject(err);
            });
          } catch (err) { finish(); reject(err); }
        }, 850);
      });
    };
    HTMLMediaElement.prototype.__pulseV46Play = true;
  }
  function rewriteVersion() {
    try {
      document.title = 'Serenity Shores Poolside Pulse V4.6';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n => {
        if (n.nodeValue) n.nodeValue = n.nodeValue
          .replaceAll('V4.5','V4.6').replaceAll('Version 4.5','Version 4.6')
          .replaceAll('V4.4','V4.6').replaceAll('Version 4.4','Version 4.6')
          .replaceAll('V4.2','V4.6').replaceAll('Version 4.2','Version 4.6')
          .replaceAll('V4.0','V4.6').replaceAll('Version 4.0','Version 4.6');
      });
    } catch {}
  }
  window.__poolsidePulseUnlockAudio = unlockReceiverAudio;
  document.addEventListener('pointerdown', () => unlockReceiverAudio('pointer tap'), { capture: true, passive: true });
  document.addEventListener('click', () => unlockReceiverAudio('click'), { capture: true });
  document.addEventListener('touchend', () => unlockReceiverAudio('touch'), { capture: true, passive: true });
  document.addEventListener('DOMContentLoaded', rewriteVersion);
  setInterval(rewriteVersion, 600);
})();
