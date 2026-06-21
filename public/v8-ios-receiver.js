(() => {
  const VERSION = '8.2';
  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';
  let unlocked = false;
  let unlocking = false;
  let unlockPromise = null;
  let hiddenAudio = null;
  let audioContext = null;
  let mediaElementPrimed = false;
  let webAudioPrimed = false;
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
      mediaElementPrimed,
      webAudioPrimed,
      audioContext: audioContext ? audioContext.state : 'unavailable',
      userActivation: navigator.userActivation
        ? {
            isActive: !!navigator.userActivation.isActive,
            hasBeenActive: !!navigator.userActivation.hasBeenActive
          }
        : null,
      status: lastStatus
    };
  }

  function dispatchStatus() {
    try {
      window.dispatchEvent(new CustomEvent('poolside-v8-audio-status', { detail: status() }));
    } catch {}
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function primeWebAudio(reason) {
    const ctx = getAudioContext();
    if (!ctx) return { ok: false, detail: 'Web Audio is unavailable in this browser.' };
    try {
      if (ctx.state !== 'running') await ctx.resume();
      const frames = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 0.03));
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate || 44100);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start(0);
      source.stop(ctx.currentTime + 0.03);
      await wait(40);
      if (ctx.state === 'running') {
        webAudioPrimed = true;
        return { ok: true, detail: `Web Audio unlocked by ${reason}.` };
      }
      return { ok: false, detail: `Web Audio is ${ctx.state}.` };
    } catch (error) {
      return { ok: false, detail: error.message || String(error) };
    }
  }

  async function primeMediaElement() {
    const audio = getHiddenAudio();
    try {
      audio.muted = true;
      audio.volume = 0;
      audio.src = SILENT_WAV;
      audio.load();
      await audio.play();
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      mediaElementPrimed = true;
      return { ok: true, detail: 'Media element primed.' };
    } catch (error) {
      return { ok: false, detail: error.message || String(error) };
    }
  }

  async function unlock(reason = 'receiver tap', options = {}) {
    if (unlocked) return true;
    if (unlockPromise) return await unlockPromise;
    unlocking = true;
    unlockPromise = (async () => {
      const webAudio = await primeWebAudio(reason);
      const mediaElement = await primeMediaElement();
      if (webAudio.ok || mediaElement.ok) {
        unlocked = true;
        lastStatus = webAudio.ok
          ? `Receiver audio unlocked by ${reason}.`
          : `Receiver media audio unlocked by ${reason}.`;
        dispatchStatus();
        return true;
      }
      unlocked = false;
      lastStatus = options.quiet
        ? 'Tap Start Receiver to unlock audio on this iPhone.'
        : `Receiver audio is still blocked. Web Audio: ${webAudio.detail} Media element: ${mediaElement.detail}`;
      dispatchStatus();
      return false;
    })();
    try {
      return await unlockPromise;
    } catch (error) {
      unlocked = false;
      lastStatus = options.quiet
        ? 'Tap Start Receiver to unlock audio on this iPhone.'
        : `Receiver audio is still blocked: ${error.message || error}`;
      dispatchStatus();
      return false;
    } finally {
      unlocking = false;
      unlockPromise = null;
    }
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
    if (ctx.state !== 'running') throw Error(`Web Audio is ${ctx.state}; tap Start Receiver on this phone.`);
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
          reject(Error('Announcement audio did not start. Tap Start Receiver on this speaker-connected device.'));
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

  window.__poolsideV8UnlockAudio = unlock;
  window.__poolsideV8AudioStatus = status;
  window.__poolsideV8PlayAnnouncementBlob = playBlob;

  const passive = { capture: true, passive: true };
  document.addEventListener('pointerdown', () => unlock('screen tap', { quiet: true }), passive);
  document.addEventListener('touchend', () => unlock('touch', { quiet: true }), passive);
  document.addEventListener('click', () => unlock('click', { quiet: true }), { capture: true });
  document.addEventListener('visibilitychange', dispatchStatus);
  document.addEventListener('DOMContentLoaded', dispatchStatus);
  dispatchStatus();
})();
