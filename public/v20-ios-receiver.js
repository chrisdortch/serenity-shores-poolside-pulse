(() => {
  const VERSION = '20.4';
  let unlocked = false;
  let unlocking = false;
  let unlockPromise = null;
  let hiddenAudio = null;
  let audioContext = null;
  let unlockToneUrl = '';
  let mediaElementPrimed = false;
  let webAudioPrimed = false;
  let lastStatus = 'Receiver audio has not been activated yet.';
  let activePlayback = null;
  let playbackSeq = 0;

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
      window.dispatchEvent(new CustomEvent('poolside-v20-audio-status', { detail: status() }));
    } catch {}
  }

  function clearActivePlayback(playback) {
    if (activePlayback && (!playback || activePlayback.id === playback.id)) activePlayback = null;
  }

  function stopActiveAudio(reason = 'stop command') {
    let stopped = false;
    const playback = activePlayback;
    if (playback && typeof playback.stop === 'function') {
      stopped = playback.stop() !== false;
    }
    const audio = hiddenAudio;
    if (audio && !audio.paused) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        stopped = true;
      } catch {}
    }
    clearActivePlayback(playback);
    lastStatus = stopped ? `Receiver foreground audio stopped by ${reason}.` : `No receiver foreground audio was playing for ${reason}.`;
    dispatchStatus();
    return stopped;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
  }

  function playbackOptions(options = {}) {
    const raw = options && typeof options === 'object' ? options : { gain: options };
    const minGain = Number.isFinite(Number(raw.minGain)) ? Number(raw.minGain) : 1;
    const maxGain = Number.isFinite(Number(raw.maxGain)) ? Number(raw.maxGain) : 6;
    const fallbackGain = raw.volume !== undefined ? Number(raw.volume) : 1;
    const gain = clampNumber(raw.gain, minGain, maxGain, fallbackGain);
    return {
      label: String(raw.label || 'Announcement'),
      gain,
      minGain,
      maxGain,
      volume: clampNumber(raw.volume, 0, 1, Math.max(0, Math.min(1, gain))),
      revokeUrl: raw.revokeUrl || ''
    };
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

  async function playWithWebAudio(blob, rawOptions = {}) {
    const options = playbackOptions(rawOptions);
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') await ctx.resume();
    if (ctx.state !== 'running') throw Error(`Web Audio is ${ctx.state}; tap Start Speaker Phone on this phone.`);
    const buffer = await decodeAudio(ctx, await blob.arrayBuffer());
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const limiter = typeof ctx.createDynamicsCompressor === 'function' ? ctx.createDynamicsCompressor() : null;
    gain.gain.value = options.gain;
    if (limiter) {
      limiter.threshold.value = -18;
      limiter.knee.value = 18;
      limiter.ratio.value = 16;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
    }
    source.buffer = buffer;
    if (limiter) source.connect(gain).connect(limiter).connect(ctx.destination);
    else source.connect(gain).connect(ctx.destination);
    return await new Promise((resolve, reject) => {
      let started = false;
      let stopped = false;
      const playback = {
        id: ++playbackSeq,
        stop() {
          stopped = true;
          try { source.stop(0); } catch {}
          return true;
        }
      };
      activePlayback = playback;
      source.onended = () => {
        clearActivePlayback(playback);
        resolve(!stopped);
      };
      try {
        source.start(0);
        started = true;
        unlocked = true;
        lastStatus = `${options.label} started through receiver Web Audio.`;
        dispatchStatus();
      } catch (error) {
        clearActivePlayback(playback);
        if (!started) reject(error);
      }
    });
  }

  async function playElementSource(src, rawOptions = {}) {
    const options = playbackOptions(rawOptions);
    const audio = getHiddenAudio();
    audio.pause();
    audio.src = src;
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.muted = false;
    audio.volume = options.volume;
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
        clearActivePlayback(playback);
        if (options.revokeUrl) {
          try { URL.revokeObjectURL(options.revokeUrl); } catch {}
        }
      };
      const onPlaying = () => {
        started = true;
        unlocked = true;
        lastStatus = `${options.label} started through receiver audio element.`;
        dispatchStatus();
      };
      const onEnded = () => {
        cleanup();
        resolve(true);
      };
      const onError = () => {
        cleanup();
        reject(Error(started ? `${options.label} audio ended with an element error.` : `${options.label} audio failed before it started.`));
      };
      const startTimer = setTimeout(() => {
        if (!started) {
          cleanup();
          reject(Error(`${options.label} audio did not start. Tap Start Speaker Phone on this speaker-connected device.`));
        }
      }, 6500);
      const playback = {
        id: ++playbackSeq,
        stop() {
          cleanup();
          try {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
          } catch {}
          resolve(false);
          return true;
        }
      };
      activePlayback = playback;
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      Promise.resolve(audio.play()).then(onPlaying).catch(error => {
        cleanup();
        reject(error instanceof Error ? error : Error(String(error || 'Audio play blocked.')));
      });
    });
  }

  async function playWithElement(blob, rawOptions = {}) {
    const url = URL.createObjectURL(blob);
    return await playElementSource(url, { ...playbackOptions(rawOptions), revokeUrl: url });
  }

  async function playBlob(blob, options = {}) {
    try {
      return await playWithWebAudio(blob, options);
    } catch (webAudioError) {
      lastStatus = `Web Audio playback path failed; trying audio element. ${webAudioError.message || webAudioError}`;
      dispatchStatus();
      return await playWithElement(blob, options);
    }
  }

  async function playAudioUrl(url, options = {}) {
    try {
      const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
      if (!response.ok) throw Error(`Audio URL returned HTTP ${response.status}`);
      return await playBlob(await response.blob(), options);
    } catch (error) {
      lastStatus = `Direct audio fetch failed; trying receiver audio element. ${error.message || error}`;
      dispatchStatus();
      return await playElementSource(url, options);
    }
  }

  window.__poolsideV20UnlockAudio = unlock;
  window.__poolsideV20AudioStatus = status;
  window.__poolsideV20PlayAnnouncementBlob = playBlob;
  window.__poolsideV20PlayAudioUrl = playAudioUrl;
  window.__poolsideV20PlayTestTone = playTestTone;
  window.__poolsideV20StopAudio = stopActiveAudio;

  const passive = { capture: true, passive: true };
  document.addEventListener('pointerdown', dispatchStatus, passive);
  document.addEventListener('touchend', dispatchStatus, passive);
  document.addEventListener('click', dispatchStatus, { capture: true });
  document.addEventListener('visibilitychange', dispatchStatus);
  document.addEventListener('DOMContentLoaded', dispatchStatus);
  dispatchStatus();
})();
