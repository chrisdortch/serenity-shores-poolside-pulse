(() => {
  const VERSION = '7.0';
  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';
  let unlocked = false;
  let unlocking = false;
  let hiddenAudio = null;
  let audioContext = null;
  let lastStatus = 'Receiver audio has not been activated yet.';

  function isiOSLike() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function getHiddenAudio() {
    if (hiddenAudio) return hiddenAudio;
    hiddenAudio = document.createElement('audio');
    hiddenAudio.preload = 'auto';
    hiddenAudio.playsInline = true;
    hiddenAudio.setAttribute('playsinline', '');
    hiddenAudio.setAttribute('webkit-playsinline', '');
    hiddenAudio.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    (document.body || document.documentElement).appendChild(hiddenAudio);
    return hiddenAudio;
  }

  function getAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audioContext ||= new AudioContext();
    return audioContext;
  }

  function status() {
    return {
      version: VERSION,
      unlocked,
      unlocking,
      isiOSLike: isiOSLike(),
      audioContext: audioContext ? audioContext.state : 'unavailable',
      status: lastStatus
    };
  }

  function dispatchStatus() {
    try {
      window.dispatchEvent(new CustomEvent('poolside-v7-audio-status', { detail: status() }));
    } catch {}
  }

  async function unlock(reason = 'receiver tap') {
    if (unlocked || unlocking) return unlocked;
    unlocking = true;
    try {
      const audio = getHiddenAudio();
      audio.muted = false;
      audio.volume = 1;
      audio.src = SILENT_WAV;
      audio.load();
      await audio.play();
      audio.pause();
      try { audio.currentTime = 0; } catch {}

      const ctx = getAudioContext();
      if (ctx && ctx.state !== 'running') await ctx.resume();

      unlocked = true;
      lastStatus = `Receiver audio activated by ${reason}.`;
      dispatchStatus();
    } catch (error) {
      lastStatus = `Receiver audio is still blocked: ${error.message || error}`;
      dispatchStatus();
    } finally {
      unlocking = false;
    }
    return unlocked;
  }

  async function decodeAudio(ctx, buffer) {
    const copy = buffer.slice(0);
    const maybe = ctx.decodeAudioData(copy);
    if (maybe && typeof maybe.then === 'function') return maybe;
    return await new Promise((resolve, reject) => ctx.decodeAudioData(copy, resolve, reject));
  }

  async function playWithWebAudio(blob, gainValue) {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') await ctx.resume();
    const buffer = await decodeAudio(ctx, await blob.arrayBuffer());
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(1, Math.min(3.4, Number(gainValue) || 1));
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    return await new Promise((resolve, reject) => {
      let started = false;
      source.onended = () => resolve(true);
      try {
        source.start(0);
        started = true;
        unlocked = true;
        lastStatus = 'Announcement started through receiver Web Audio.';
        dispatchStatus();
      } catch (error) {
        if (!started) reject(error);
      }
    });
  }

  async function playWithElement(blob) {
    const audio = getHiddenAudio();
    const url = URL.createObjectURL(blob);
    audio.pause();
    audio.src = url;
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.muted = false;
    audio.volume = 1;
    audio.load();
    return await new Promise((resolve, reject) => {
      let started = false;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(startTimer);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        try { URL.revokeObjectURL(url); } catch {}
      };
      const onPlaying = () => {
        started = true;
        unlocked = true;
        lastStatus = 'Announcement started through receiver audio element.';
        dispatchStatus();
      };
      const onEnded = () => {
        cleanup();
        resolve(true);
      };
      const onError = () => {
        cleanup();
        reject(Error(started ? 'Announcement audio ended with an element error.' : 'Announcement audio failed before it started.'));
      };
      const startTimer = setTimeout(() => {
        if (!started) {
          cleanup();
          reject(Error('Announcement audio did not start. Tap Activate Receiver on this speaker-connected device.'));
        }
      }, 6500);
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      Promise.resolve(audio.play()).then(onPlaying).catch(error => {
        cleanup();
        reject(error instanceof Error ? error : Error(String(error || 'Audio play blocked.')));
      });
    });
  }

  async function playBlob(blob, options = {}) {
    const gain = Number(options.gain || 1);
    try {
      return await playWithWebAudio(blob, gain);
    } catch (webAudioError) {
      lastStatus = `Web Audio voice path failed; trying audio element. ${webAudioError.message || webAudioError}`;
      dispatchStatus();
      return await playWithElement(blob);
    }
  }

  window.__poolsideV7UnlockAudio = unlock;
  window.__poolsideV7AudioStatus = status;
  window.__poolsideV7PlayAnnouncementBlob = playBlob;

  const passive = { capture: true, passive: true };
  document.addEventListener('pointerdown', () => unlock('pointer tap'), passive);
  document.addEventListener('touchend', () => unlock('touch'), passive);
  document.addEventListener('click', () => unlock('click'), { capture: true });
  document.addEventListener('DOMContentLoaded', dispatchStatus);
  dispatchStatus();
})();
