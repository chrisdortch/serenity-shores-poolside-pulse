(() => {
  const VERSION = '17';
  let unlocked = false;
  let unlocking = false;
  let unlockPromise = null;
  let hiddenAudio = null;
  let audioContext = null;
  let unlockToneUrl = '';
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

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function getUnlockToneUrl() {
    if (unlockToneUrl) return unlockToneUrl;
    const sampleRate = 22050;
    const seconds = 0.45;
    const samples = Math.floor(sampleRate * seconds);
    const bytes = new Uint8Array(44 + samples * 2);
    const view = new DataView(bytes.buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i += 1) {
      const attack = Math.min(1, i / (sampleRate * 0.02));
      const release = Math.min(1, (samples - i) / (sampleRate * 0.04));
      const envelope = Math.max(0, Math.min(attack, release));
      const tone = Math.sin((2 * Math.PI * 660 * i) / sampleRate);
      view.setInt16(44 + i * 2, Math.round(tone * 32767 * 0.5 * envelope), true);
    }
    unlockToneUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    return unlockToneUrl;
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
      window.dispatchEvent(new CustomEvent('poolside-v17-audio-status', { detail: status() }));
    } catch {}
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(message)), ms);
      Promise.resolve(promise).then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  async function primeWebAudio(reason, options = {}) {
    const ctx = getAudioContext();
    if (!ctx) return { ok: false, detail: 'Web Audio is unavailable in this browser.' };
    try {
      const resume = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const duration = options.audible ? 0.45 : 0.04;
      const start = ctx.currentTime || 0;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, start);
      gain.gain.setValueAtTime(options.audible ? 0.14 : 0.0001, start);
      gain.gain.linearRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
      await withTimeout(resume, 900, 'Web Audio resume timed out.');
      await wait(options.audible ? 480 : 55);
      if (ctx.state === 'running') {
        webAudioPrimed = true;
        return { ok: true, detail: options.audible ? `Receiver test tone played by ${reason}.` : `Web Audio unlocked by ${reason}.` };
      }
      return { ok: false, detail: `Web Audio is ${ctx.state}.` };
    } catch (error) {
      return { ok: false, detail: error.message || String(error) };
    }
  }

  async function primeMediaElement(options = {}) {
    const audio = getHiddenAudio();
    try {
      audio.muted = false;
      audio.volume = options.audible ? 0.75 : 0.03;
      audio.src = getUnlockToneUrl();
      audio.load();
      await withTimeout(audio.play(), 1000, 'Media element play timed out.');
      await wait(options.audible ? 480 : 55);
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      mediaElementPrimed = true;
      return { ok: true, detail: options.audible ? 'Receiver test tone played through media element.' : 'Media element primed.' };
    } catch (error) {
      return { ok: false, detail: error.message || String(error) };
    }
  }

  async function playTestTone(reason = 'receiver test tone') {
    const [webAudio, mediaElement] = await Promise.all([
      primeWebAudio(reason, { audible: true }),
      primeMediaElement({ audible: true })
    ]);
    if (webAudio.ok || mediaElement.ok) {
      unlocked = true;
      lastStatus = webAudio.ok ? webAudio.detail : mediaElement.detail;
      dispatchStatus();
      return true;
    }
    lastStatus = `Receiver test tone blocked. Web Audio: ${webAudio.detail} Media element: ${mediaElement.detail}`;
    dispatchStatus();
    return false;
  }

  async function unlock(reason = 'receiver tap', options = {}) {
    if (unlocked) {
      if (options.audible || options.testTone) return await playTestTone(reason);
      return true;
    }
    if (unlockPromise) return await unlockPromise;
    unlocking = true;
    unlockPromise = (async () => {
      const audible = !!options.audible || !!options.testTone;
      const [webAudio, mediaElement] = await Promise.all([
        primeWebAudio(reason, { audible }),
        primeMediaElement({ audible })
      ]);
      if (webAudio.ok || mediaElement.ok) {
        unlocked = true;
        lastStatus = audible
          ? (webAudio.ok ? webAudio.detail : mediaElement.detail)
          : webAudio.ok
            ? `Receiver audio unlocked by ${reason}.`
            : `Receiver media audio unlocked by ${reason}.`;
        dispatchStatus();
        return true;
      }
      unlocked = false;
      lastStatus = options.quiet
        ? 'Tap Start Speaker Phone to unlock audio on this iPhone.'
        : `Receiver audio is still blocked. Web Audio: ${webAudio.detail} Media element: ${mediaElement.detail}`;
      dispatchStatus();
      return false;
    })();
    try {
      return await unlockPromise;
    } catch (error) {
      unlocked = false;
      lastStatus = options.quiet
        ? 'Tap Start Speaker Phone to unlock audio on this iPhone.'
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
    if (ctx.state !== 'running') throw Error(`Web Audio is ${ctx.state}; tap Start Speaker Phone on this phone.`);
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
          reject(Error('Announcement audio did not start. Tap Start Speaker Phone on this speaker-connected device.'));
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

  window.__poolsideV17UnlockAudio = unlock;
  window.__poolsideV17AudioStatus = status;
  window.__poolsideV17PlayAnnouncementBlob = playBlob;
  window.__poolsideV17PlayTestTone = playTestTone;

  const passive = { capture: true, passive: true };
  document.addEventListener('pointerdown', dispatchStatus, passive);
  document.addEventListener('touchend', dispatchStatus, passive);
  document.addEventListener('click', dispatchStatus, { capture: true });
  document.addEventListener('visibilitychange', dispatchStatus);
  document.addEventListener('DOMContentLoaded', dispatchStatus);
  dispatchStatus();
})();
