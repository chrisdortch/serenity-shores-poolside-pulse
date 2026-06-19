(() => {
  const PATCH_VERSION = '5.10';
  const tracked = new Set();
  const ducked = new Map();
  let duckDepth = 0;
  let annAudio = null;
  let unlockAudio = null;
  let unlocked = false;
  let unlocking = false;
  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';

  function ua() { return String(navigator.userAgent || ''); }
  function isiPhoneLike() {
    return /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isSafariLike() {
    const u = ua();
    return /Safari/i.test(u) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(u);
  }
  const USE_MUTE_DUCK = isiPhoneLike() || isSafariLike();

  function getSrc(media) {
    try { return String(media.currentSrc || media.src || ''); } catch { return ''; }
  }
  function isAnnouncementSrc(src) {
    src = String(src || '');
    return src.startsWith('blob:') || src.includes('/api/tts');
  }
  function isPlaying(media) {
    try { return !!media && !media.paused && !media.ended && media.readyState > 0 && !!getSrc(media); } catch { return false; }
  }
  function sameUrl(a, b) {
    try { return new URL(a, location.href).href === new URL(b, location.href).href; } catch { return String(a || '') === String(b || ''); }
  }
  function note(text) {
    try {
      window.__pulseV510Status = text;
      const box = document.getElementById('feedbackBox');
      const bodyText = document.body ? String(document.body.innerText || '') : '';
      const receiverScreen = /Activate Receiver|Station Ready|Receiver active|RECEIVER/i.test(bodyText);
      if (box && receiverScreen && !box.innerHTML.includes(text)) box.innerHTML += '<br><b>V5.10 iPhone:</b> ' + text;
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

  function remember(media) {
    try {
      const src = getSrc(media);
      if (!src || isAnnouncementSrc(src)) return;
      if (!ducked.has(media)) {
        ducked.set(media, {
          src,
          time: Number.isFinite(media.currentTime) ? media.currentTime : 0,
          volume: Number.isFinite(media.volume) ? media.volume : 0.95,
          muted: !!media.muted,
          wasPlaying: isPlaying(media) || !media.paused
        });
      }
    } catch {}
  }
  function musicPlayers(except) {
    return [...tracked].filter(media => media && media !== except && media !== getUnlockAudio() && !isAnnouncementSrc(getSrc(media)));
  }
  function fade(media, target, ms = 700) {
    try {
      const start = Number.isFinite(media.volume) ? media.volume : 0.95;
      const steps = 14;
      let i = 0;
      clearInterval(media.__pulseV59FadeTimer);
      media.__pulseV59FadeTimer = setInterval(() => {
        i += 1;
        try { media.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps))); } catch {}
        if (i >= steps) clearInterval(media.__pulseV59FadeTimer);
      }, Math.max(20, ms / steps));
    } catch {}
  }
  function duck(reason = 'announcement') {
    duckDepth += 1;
    musicPlayers().forEach(media => {
      remember(media);
      try {
        if (USE_MUTE_DUCK) {
          media.muted = true;
        } else {
          fade(media, 0, 650);
        }
      } catch {}
    });
    note(USE_MUTE_DUCK ? `Safari-safe mute duck before ${reason}` : `volume fade before ${reason}`);
  }
  async function restoreMedia(media, snap) {
    try {
      const currentSrc = getSrc(media);
      if (snap.src && currentSrc && !sameUrl(currentSrc, snap.src)) return;
      if (!currentSrc && snap.src) media.src = snap.src;
      if (snap.time > 1 && Number.isFinite(media.currentTime) && media.currentTime < Math.max(0, snap.time - 2)) {
        try { media.currentTime = snap.time; } catch {}
      }
      if (USE_MUTE_DUCK) {
        media.muted = snap.muted;
      } else {
        fade(media, snap.volume || 0.95, 900);
      }
      if ((media.paused || media.ended) && snap.wasPlaying) {
        try { await media.play(); } catch (e) { note('restore play blocked; tap Activate Sound on this iPhone.'); }
      }
      if (!USE_MUTE_DUCK) media.__pulseOriginalVolume = undefined;
    } catch (e) {
      note('restore error: ' + (e && e.message ? e.message : e));
    }
  }
  function unduck(reason = 'announcement finished') {
    duckDepth = Math.max(0, duckDepth - 1);
    if (duckDepth > 0) return;
    const saved = [...ducked.entries()];
    ducked.clear();
    setTimeout(async () => {
      for (const [media, snap] of saved) await restoreMedia(media, snap);
      note(USE_MUTE_DUCK ? `Safari-safe music unmuted after ${reason}` : `music faded back after ${reason}`);
    }, 120);
  }

  async function unlockReceiverAudio(reason = 'receiver activation tap') {
    if (unlocked || unlocking) return unlocked;
    unlocking = true;
    try {
      for (const a of [getUnlockAudio(), getAnnAudio()]) {
        a.muted = false;
        try { a.volume = 1; } catch {}
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
      note('audio unlocked by ' + reason + '.');
    } catch (e) {
      note('audio still blocked: tap Activate Sound / Play Station on this iPhone, then send announcement again.');
    } finally {
      unlocking = false;
    }
    return unlocked;
  }

  const NativeAudio = window.Audio;
  function PatchedAudio(src) {
    if (isAnnouncementSrc(src)) {
      const a = getAnnAudio();
      if (src && a.src !== src) a.src = src;
      a.muted = false;
      try { a.volume = 1; } catch {}
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
  if (!HTMLMediaElement.prototype.__pulseV59Play) {
    HTMLMediaElement.prototype.play = function(...args) {
      tracked.add(this);
      const announcement = isAnnouncementSrc(getSrc(this));
      if (!announcement) {
        unlockReceiverAudio('Home sound activation').catch(() => {});
        return nativePlay.apply(this, args);
      }
      duck('AI audio announcement');
      this.muted = false;
      try { this.volume = 1; } catch {}
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let finished = false;
          const finish = () => { if (finished) return; finished = true; unduck('AI audio announcement'); };
          try {
            this.playsInline = true;
            this.setAttribute('playsinline', '');
            this.setAttribute('webkit-playsinline', '');
            this.addEventListener('ended', finish, { once: true });
            this.addEventListener('pause', () => {
              try {
                if (this.ended || (Number.isFinite(this.duration) && this.duration > 0 && this.currentTime >= this.duration - 0.25)) finish();
              } catch {}
            });
            this.addEventListener('error', finish, { once: true });
            setTimeout(finish, 180000);
            Promise.resolve(nativePlay.apply(this, args)).then(resolve).catch(err => {
              finish();
              note('announcement play blocked; tap Activate Sound / Play Station on this receiver.');
              reject(err);
            });
          } catch (err) { finish(); reject(err); }
        }, USE_MUTE_DUCK ? 120 : 650);
      });
    };
    HTMLMediaElement.prototype.__pulseV59Play = true;
  }

  if ('speechSynthesis' in window && !window.speechSynthesis.__pulseV59Speak) {
    const nativeSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    const nativeCancel = window.speechSynthesis.cancel.bind(window.speechSynthesis);
    window.speechSynthesis.speak = utterance => {
      duck('device voice announcement');
      if (utterance) {
        const oldEnd = utterance.onend;
        const oldError = utterance.onerror;
        utterance.onend = event => { try { oldEnd && oldEnd.call(utterance, event); } finally { unduck('device voice ended'); } };
        utterance.onerror = event => { try { oldError && oldError.call(utterance, event); } finally { unduck('device voice error'); } };
      }
      return nativeSpeak(utterance);
    };
    window.speechSynthesis.cancel = () => {
      try { nativeCancel(); } finally { setTimeout(() => unduck('device voice cancelled'), 60); }
    };
    window.speechSynthesis.__pulseV59Speak = true;
  }

  function rewriteVersion() {
    try {
      document.title = 'Serenity Shores Poolside Pulse V5.10';
      const root = document.getElementById('app');
      if (root) root.dataset.version = '5.10';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n => {
        if (n.nodeValue) n.nodeValue = n.nodeValue
          .replaceAll('V5.9','V5.10').replaceAll('Version 5.9','Version 5.10')
          .replaceAll('V5.0','V5.10').replaceAll('Version 5.0','Version 5.10')
          .replaceAll('V4.9','V5.10').replaceAll('Version 4.9','Version 5.10')
          .replaceAll('V4.8','V5.10').replaceAll('Version 4.8','Version 5.10')
          .replaceAll('V4.7','V5.10').replaceAll('Version 4.7','Version 5.10')
          .replaceAll('V4.6','V5.10').replaceAll('Version 4.6','Version 5.10')
          .replaceAll('V4.5','V5.10').replaceAll('Version 4.5','Version 5.10')
          .replaceAll('V4.4','V5.10').replaceAll('Version 4.4','Version 5.10')
          .replaceAll('V4.2','V5.10').replaceAll('Version 4.2','Version 5.10')
          .replaceAll('V4.0','V5.10').replaceAll('Version 4.0','Version 5.10');
      });
    } catch {}
  }

  window.__poolsidePulseUnlockAudio = unlockReceiverAudio;
  window.__poolsidePulseV59Audio = { version: PATCH_VERSION, useMuteDuck: USE_MUTE_DUCK, isiPhoneLike: isiPhoneLike(), isSafariLike: isSafariLike() };
  document.addEventListener('pointerdown', () => unlockReceiverAudio('pointer tap'), { capture: true, passive: true });
  document.addEventListener('click', () => unlockReceiverAudio('click'), { capture: true });
  document.addEventListener('touchend', () => unlockReceiverAudio('touch'), { capture: true, passive: true });
  document.addEventListener('DOMContentLoaded', rewriteVersion);
  setInterval(rewriteVersion, 600);
  rewriteVersion();
})();
