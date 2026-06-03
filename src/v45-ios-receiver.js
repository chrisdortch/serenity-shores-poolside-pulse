(() => {
  const PATCH_VERSION = '4.5';
  const SILENT_WAV = 'data:audio/wav;base64,UklGRggHAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YeQGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const tracked = new Set();
  let annAudio = null;
  let unlockAudio = null;
  let unlocked = false;
  let unlocking = false;
  let duckDepth = 0;

  function isAnnouncementSrc(src) {
    src = String(src || '');
    return src.startsWith('blob:') || src.includes('/api/tts');
  }
  function getSrc(media) { try { return String(media.currentSrc || media.src || ''); } catch { return ''; } }
  function isPlaying(media) { try { return media && !media.paused && !media.ended && media.readyState > 0 && getSrc(media); } catch { return false; } }
  function note(text) {
    try {
      window.__pulseV45Status = text;
      const box = document.getElementById('feedbackBox');
      if (box && !box.textContent.includes(text)) box.innerHTML += '<br><b>V4.5:</b> ' + text;
    } catch {}
  }
  function makeHiddenAudio() {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.playsInline = true;
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    try { document.body.appendChild(a); } catch { document.documentElement.appendChild(a); }
    tracked.add(a);
    return a;
  }
  function getAnnAudio() {
    if (!annAudio) annAudio = makeHiddenAudio();
    return annAudio;
  }
  function getUnlockAudio() {
    if (!unlockAudio) unlockAudio = makeHiddenAudio();
    return unlockAudio;
  }
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
  function musicPlayers(except) { return [...tracked].filter(media => media !== except && !isAnnouncementSrc(getSrc(media)) && media !== getUnlockAudio()); }
  function duck(except) {
    duckDepth += 1;
    musicPlayers(except).forEach(media => { if (isPlaying(media)) fade(media, 0, 850); });
    note('music fading to zero before announcement');
  }
  function unduck() {
    duckDepth = Math.max(0, duckDepth - 1);
    if (duckDepth > 0) return;
    setTimeout(() => {
      musicPlayers(null).forEach(media => {
        if (!isPlaying(media)) return;
        const target = Number.isFinite(media.__pulseOriginalVolume) ? media.__pulseOriginalVolume : 0.95;
        fade(media, target, 1000);
        media.__pulseOriginalVolume = undefined;
      });
      note('music fading back up after announcement');
    }, 150);
  }

  async function unlockReceiverAudio(reason = 'receiver activation tap') {
    if (unlocked || unlocking) return unlocked;
    unlocking = true;
    try {
      const unlocker = getUnlockAudio();
      unlocker.muted = false;
      unlocker.volume = 1;
      unlocker.src = SILENT_WAV;
      unlocker.load();
      await unlocker.play();
      unlocker.pause();
      try { unlocker.currentTime = 0; } catch {}

      const a = getAnnAudio();
      const oldSrc = a.src;
      a.muted = false;
      a.volume = 1;
      a.src = SILENT_WAV;
      a.load();
      await a.play();
      a.pause();
      try { a.currentTime = 0; } catch {}
      if (oldSrc && !oldSrc.startsWith('data:audio/wav')) a.src = oldSrc;

      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          window.__pulseAudioContext = window.__pulseAudioContext || new AudioContext();
          if (window.__pulseAudioContext.state !== 'running') await window.__pulseAudioContext.resume();
        }
      } catch {}
      try {
        if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          window.speechSynthesis.speak(u);
        }
      } catch {}
      unlocked = true;
      note('iPhone receiver audio unlocked for remote announcements by ' + reason + '.');
    } catch (e) {
      note('iPhone announcement audio still blocked: ' + (e && e.message ? e.message : e) + '. Tap Activate Sound / Play Station on this iPhone, then send announcement again.');
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
  if (!HTMLMediaElement.prototype.__pulseV45Play) {
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
          const finish = () => {
            if (finished) return;
            finished = true;
            unduck();
          };
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
          } catch (err) {
            finish();
            reject(err);
          }
        }, 850);
      });
    };
    HTMLMediaElement.prototype.__pulseV45Play = true;
  }

  if (window.speechSynthesis && !window.speechSynthesis.__pulseV45Speak) {
    const nativeSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = utterance => {
      duck(null);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        unduck();
      };
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
      setTimeout(() => nativeSpeak(utterance), 850);
    };
    window.speechSynthesis.__pulseV45Speak = true;
  }

  function rewriteVersion() {
    try {
      document.title = 'Serenity Shores Poolside Pulse V4.5';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n => {
        if (n.nodeValue) n.nodeValue = n.nodeValue
          .replaceAll('V4.4', 'V4.5')
          .replaceAll('V4.2', 'V4.5')
          .replaceAll('V4.0', 'V4.5')
          .replaceAll('Version 4.4', 'Version 4.5')
          .replaceAll('Version 4.2', 'Version 4.5')
          .replaceAll('Version 4.0', 'Version 4.5');
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
