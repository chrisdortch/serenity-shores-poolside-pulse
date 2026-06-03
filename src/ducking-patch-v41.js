(() => {
  const tracked = new Set();
  const originalAudio = window.Audio;
  let duckDepth = 0;
  let restoreTimer = null;

  function isPlaying(a) {
    try { return a && !a.paused && !a.ended && a.readyState > 0; } catch { return false; }
  }

  function fadeAudio(a, target, ms = 450) {
    try {
      if (!a.__pulseOriginalVolume && a.__pulseOriginalVolume !== 0) a.__pulseOriginalVolume = Number.isFinite(a.volume) ? a.volume : 0.95;
      const start = Number.isFinite(a.volume) ? a.volume : 0.95;
      const steps = 10;
      let i = 0;
      clearInterval(a.__pulseFadeTimer);
      a.__pulseFadeTimer = setInterval(() => {
        i += 1;
        try { a.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps))); } catch {}
        if (i >= steps) clearInterval(a.__pulseFadeTimer);
      }, Math.max(20, ms / steps));
    } catch {}
  }

  function duck(except) {
    duckDepth += 1;
    clearTimeout(restoreTimer);
    tracked.forEach(a => {
      if (a !== except && isPlaying(a)) fadeAudio(a, 0.08, 500);
    });
    const box = document.getElementById('feedbackBox');
    if (box && !box.textContent.includes('music ducked')) box.innerHTML += '<br><b>Audio:</b> music ducked for announcement.';
  }

  function unduck() {
    duckDepth = Math.max(0, duckDepth - 1);
    if (duckDepth > 0) return;
    restoreTimer = setTimeout(() => {
      tracked.forEach(a => {
        const target = Number.isFinite(a.__pulseOriginalVolume) ? a.__pulseOriginalVolume : 0.95;
        if (isPlaying(a)) fadeAudio(a, target, 700);
        a.__pulseOriginalVolume = undefined;
      });
    }, 150);
  }

  function PatchedAudio(...args) {
    const a = new originalAudio(...args);
    tracked.add(a);
    const originalPlay = a.play.bind(a);
    a.play = (...playArgs) => {
      const src = String(a.currentSrc || a.src || '');
      const isAnnouncementAudio = src.startsWith('blob:') || src.includes('/api/tts');
      if (isAnnouncementAudio) duck(a);
      const p = originalPlay(...playArgs);
      if (isAnnouncementAudio) {
        const done = () => unduck();
        a.addEventListener('ended', done, { once: true });
        a.addEventListener('pause', done, { once: true });
        setTimeout(done, 120000);
      }
      return p;
    };
    return a;
  }
  PatchedAudio.prototype = originalAudio.prototype;
  window.Audio = PatchedAudio;

  if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
    const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = utterance => {
      duck(null);
      const finish = () => unduck();
      try {
        utterance.addEventListener('end', finish, { once: true });
        utterance.addEventListener('error', finish, { once: true });
      } catch {
        const oldEnd = utterance.onend;
        utterance.onend = e => { if (oldEnd) oldEnd(e); finish(); };
        const oldError = utterance.onerror;
        utterance.onerror = e => { if (oldError) oldError(e); finish(); };
      }
      setTimeout(finish, 120000);
      return originalSpeak(utterance);
    };
  }
})();
