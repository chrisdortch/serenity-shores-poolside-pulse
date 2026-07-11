(() => {
  const VERSION = '23';
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
      window.dispatchEvent(new CustomEvent('poolside-v23-audio-status', { detail: status() }));
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

  function setActiveVolume(volume = 1) {
    const level = clampNumber(volume, 0, 1, 1);
    let changed = false;
    const playback = activePlayback;
    if (playback && typeof playback.setVolume === 'function') {
      try {
        playback.setVolume(level);
        changed = true;
      } catch {}
    }
    const audio = hiddenAudio;
    if (audio && !audio.paused) {
      try {
        audio.volume = level;
        changed = true;
      } catch {}
    }
    if (changed) {
      lastStatus = `Receiver foreground volume set to ${Math.round(level * 100)}%.`;
      dispatchStatus();
    }
    return changed;
  }

  async function playBuiltInQuietBed(rawOptions = {}) {
    const options = playbackOptions({
      label: 'Built-in quiet music bed',
      volume: 0.1,
      gain: 0.1,
      minGain: 0,
      maxGain: 1,
      loop: true,
      ...rawOptions
    });
    const ctx = getAudioContext();
    if (!ctx) throw Error('Web Audio is unavailable for the built-in quiet bed.');
    if (ctx.state !== 'running') await ctx.resume();
    if (ctx.state !== 'running') throw Error(`Web Audio is ${ctx.state}; tap Start Receiver on this speaker phone.`);

    stopActiveAudio('built-in quiet bed restart');

    const start = (ctx.currentTime || 0) + 0.03;
    const master = ctx.createGain();
    const pad = ctx.createGain();
    const shimmer = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const nodes = [];

    const outputLevel = quietBedOutputLevel(options.volume);
    master.gain.setValueAtTime(0.0001, start);
    master.gain.linearRampToValueAtTime(outputLevel, start + 1.2);
    pad.gain.value = 0.28;
    shimmer.gain.value = 0.07;
    filter.type = 'lowpass';
    filter.frequency.value = 1150;
    filter.Q.value = 0.65;
    lfo.type = 'sine';
    lfo.frequency.value = 0.035;
    lfoGain.gain.value = Math.min(0.014, Math.max(0.003, outputLevel * 0.035));
    lfo.connect(lfoGain).connect(master.gain);
    lfo.start(start);
    nodes.push(lfo);

    const makeOscillator = (frequency, type, target, gainValue, detune = 0) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      gain.gain.value = gainValue;
      osc.connect(gain).connect(target);
      osc.start(start);
      nodes.push(osc, gain);
    };

    makeOscillator(196, 'sine', pad, 0.58, -4);
    makeOscillator(246.94, 'sine', pad, 0.42, 3);
    makeOscillator(329.63, 'triangle', shimmer, 0.18, -7);
    makeOscillator(392, 'sine', shimmer, 0.12, 5);

    const noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < noise.length; i += 1) {
      brown = (brown + 0.018 * (Math.random() * 2 - 1)) / 1.018;
      noise[i] = brown * 3.2;
    }
    const noiseSource = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    noiseGain.gain.value = 0.024;
    noiseSource.connect(noiseGain).connect(filter);
    noiseSource.start(start);
    nodes.push(noiseSource, noiseGain);

    pad.connect(filter);
    shimmer.connect(filter);
    filter.connect(master).connect(ctx.destination);

    return await new Promise(resolve => {
      let stopped = false;
      let cleaned = false;
      const playback = {
        id: ++playbackSeq,
        setVolume(value) {
          const level = quietBedOutputLevel(value);
          try { master.gain.setTargetAtTime(level, ctx.currentTime || 0, 0.05); } catch { master.gain.value = level; }
        },
        stop() {
          if (stopped) return true;
          stopped = true;
          const now = ctx.currentTime || 0;
          try { master.gain.cancelScheduledValues(now); } catch {}
          try { master.gain.setTargetAtTime(0.0001, now, 0.08); } catch { master.gain.value = 0.0001; }
          setTimeout(() => {
            if (cleaned) return;
            cleaned = true;
            nodes.forEach(node => {
              try {
                if (typeof node.stop === 'function') node.stop(0);
                if (typeof node.disconnect === 'function') node.disconnect();
              } catch {}
            });
            try { master.disconnect(); } catch {}
            try { filter.disconnect(); } catch {}
            clearActivePlayback(playback);
            resolve(false);
          }, 180);
          return true;
        }
      };
      activePlayback = playback;
      unlocked = true;
      webAudioPrimed = true;
      lastStatus = `${options.label} started through receiver Web Audio at ${Math.round(options.volume * 100)}% requested / ${Math.round(outputLevel * 100)}% audible bed output.`;
      dispatchStatus();
    });
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
  }

  function quietBedOutputLevel(value) {
    const requested = clampNumber(value, 0, 1, 0.25);
    if (requested <= 0) return 0;
    return clampNumber(0.08 + requested * 1.45, 0, 0.58, 0.25);
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
      voiceGain: clampNumber(raw.voiceGain, 0, 800, 800),
      volume: clampNumber(raw.volume, 0, 1, Math.max(0, Math.min(1, gain))),
      loop: !!raw.loop,
      revokeUrl: raw.revokeUrl || ''
    };
  }

  function isVoicePlayback(label = '') {
    return /voice|announcement|spoken|speech/i.test(String(label || ''));
  }

  function analyzeBuffer(buffer) {
    let peak = 0;
    let sumSquares = 0;
    let count = 0;
    const channels = Math.max(1, Number(buffer?.numberOfChannels || 0));
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const channel = buffer.getChannelData(channelIndex);
      const stride = Math.max(1, Math.floor(channel.length / 240000));
      for (let i = 0; i < channel.length; i += stride) {
        const sample = channel[i] || 0;
        const absolute = Math.abs(sample);
        if (absolute > peak) peak = absolute;
        sumSquares += sample * sample;
        count += 1;
      }
    }
    return {
      peak,
      rms: count ? Math.sqrt(sumSquares / count) : 0
    };
  }

  function voiceLoudnessSettings(buffer, options) {
    const analysis = analyzeBuffer(buffer);
    const maxGain = Math.max(1, Number(options.maxGain || 64) || 64);
    const requested = clampNumber(options.gain, 1, maxGain, maxGain);
    const requestedStrength = Math.max(0, Math.min(1, (requested - 1) / Math.max(1, maxGain - 1)));
    const managerStrength = Math.max(0, Math.min(1, clampNumber(options.voiceGain, 0, 800, 800) / 800));
    const strength = Math.max(requestedStrength, managerStrength);
    const targetRms = 0.21 + strength * 0.18;
    const rmsGain = analysis.rms ? targetRms / analysis.rms : 1;
    const peakGain = analysis.peak ? 3.05 / analysis.peak : rmsGain;
    const driveGain = Math.max(1, Math.min(16, rmsGain, peakGain));
    return {
      driveGain,
      outputGain: 0.96 + strength * 0.025,
      threshold: -24 - strength * 8,
      ratio: 14 + strength * 12,
      knee: 5,
      peak: analysis.peak,
      rms: analysis.rms
    };
  }

  function createSoftLimiter(ctx) {
    if (typeof ctx.createWaveShaper !== 'function') return null;
    const shaper = ctx.createWaveShaper();
    const samples = 65536;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      const x = (i / (samples - 1)) * 4 - 2;
      curve[i] = Math.tanh(x * 1.55) / Math.tanh(1.55);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    return shaper;
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
    const drive = ctx.createGain();
    const makeup = ctx.createGain();
    const limiter = typeof ctx.createDynamicsCompressor === 'function' ? ctx.createDynamicsCompressor() : null;
    const voice = isVoicePlayback(options.label) || Number(options.maxGain || 0) > 1;
    const settings = voice ? voiceLoudnessSettings(buffer, options) : null;
    drive.gain.value = voice ? settings.driveGain : options.gain;
    makeup.gain.value = voice ? settings.outputGain : 1;
    if (limiter) {
      limiter.threshold.value = voice ? settings.threshold : -24;
      limiter.knee.value = voice ? settings.knee : 14;
      limiter.ratio.value = voice ? settings.ratio : 20;
      limiter.attack.value = voice ? 0.002 : 0.002;
      limiter.release.value = voice ? 0.16 : 0.14;
    }
    source.buffer = buffer;
    source.loop = !!options.loop;
    if (voice) {
      const highpass = ctx.createBiquadFilter();
      const presence = ctx.createBiquadFilter();
      const bite = ctx.createBiquadFilter();
      const lowpass = ctx.createBiquadFilter();
      const softLimiter = createSoftLimiter(ctx);
      highpass.type = 'highpass';
      highpass.frequency.value = 140;
      presence.type = 'peaking';
      presence.frequency.value = 2650;
      presence.Q.value = 1.05;
      presence.gain.value = 3.2;
      bite.type = 'peaking';
      bite.frequency.value = 4200;
      bite.Q.value = 0.85;
      bite.gain.value = 1.8;
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 9000;
      source.connect(highpass).connect(presence).connect(bite).connect(lowpass).connect(drive);
      if (limiter && softLimiter) drive.connect(limiter).connect(softLimiter).connect(makeup).connect(ctx.destination);
      else if (limiter) drive.connect(limiter).connect(makeup).connect(ctx.destination);
      else if (softLimiter) drive.connect(softLimiter).connect(makeup).connect(ctx.destination);
      else drive.connect(makeup).connect(ctx.destination);
    } else if (limiter) {
      source.connect(drive).connect(limiter).connect(makeup).connect(ctx.destination);
    } else {
      source.connect(drive).connect(ctx.destination);
    }
    return await new Promise((resolve, reject) => {
      let started = false;
      let stopped = false;
      const playback = {
        id: ++playbackSeq,
        setVolume(value) {
          if (!voice) drive.gain.value = clampNumber(value, 0, 1, options.volume);
        },
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
        lastStatus = voice
          ? `${options.label} started through clear PA voice path.`
          : `${options.label} started through receiver Web Audio.`;
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
    audio.loop = !!options.loop;
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
        setVolume(value) {
          audio.volume = clampNumber(value, 0, 1, options.volume);
        },
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

  window.__poolsideV23UnlockAudio = unlock;
  window.__poolsideV23AudioStatus = status;
  window.__poolsideV23PlayAnnouncementBlob = playBlob;
  window.__poolsideV23PlayAudioUrl = playAudioUrl;
  window.__poolsideV23PlayQuietBed = playBuiltInQuietBed;
  window.__poolsideV23PlayTestTone = playTestTone;
  window.__poolsideV23StopAudio = stopActiveAudio;
  window.__poolsideV23SetActiveVolume = setActiveVolume;

  const passive = { capture: true, passive: true };
  document.addEventListener('pointerdown', dispatchStatus, passive);
  document.addEventListener('touchend', dispatchStatus, passive);
  document.addEventListener('click', dispatchStatus, { capture: true });
  document.addEventListener('visibilitychange', dispatchStatus);
  document.addEventListener('DOMContentLoaded', dispatchStatus);
  dispatchStatus();
})();
