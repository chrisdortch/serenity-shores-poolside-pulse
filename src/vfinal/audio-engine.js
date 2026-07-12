import {
  DUCK_LEVEL_PERCENT,
  MUSIC_LEVEL_PERCENT,
  VOICE_LEVEL_PERCENT,
  clamp
} from './core.js';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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

function waitFor(target, successEvent, errorEvent, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(successEvent, onSuccess);
      if (errorEvent) target.removeEventListener(errorEvent, onError);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onSuccess = () => finish(resolve, true);
    const onError = () => finish(reject, new Error(message));
    const timer = setTimeout(() => finish(reject, new Error(message)), timeoutMs);
    target.addEventListener(successEvent, onSuccess, { once: true });
    if (errorEvent) target.addEventListener(errorEvent, onError, { once: true });
  });
}

export function isIOSLike(userAgent = globalThis.navigator?.userAgent || '', platform = globalThis.navigator?.platform || '', maxTouchPoints = globalThis.navigator?.maxTouchPoints || 0) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && Number(maxTouchPoints) > 1);
}

function audioContextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function silentPrimeBlob() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount, true);
  bytes.fill(128, 44);
  return new Blob([bytes], { type: 'audio/wav' });
}

function analyzeBuffer(buffer) {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  const stride = Math.max(1, Math.floor(buffer.length / 250_000));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += stride) {
      const value = Math.abs(samples[i]);
      peak = Math.max(peak, value);
      sumSquares += value * value;
      count += 1;
    }
  }
  return { peak, rms: count ? Math.sqrt(sumSquares / count) : 0 };
}

function normalizedVoiceGain(buffer) {
  const { peak, rms } = analyzeBuffer(buffer);
  if (!peak || !rms) return 1;
  const peakLimited = 0.92 / peak;
  const rmsTargeted = 0.2 / rms;
  return clamp(Math.min(peakLimited, rmsTargeted), 0.75, 3.5, 1);
}

export function estimateDeviceSpeechTimeoutMs(text, rate = 0.94) {
  const message = String(text || '').trim();
  const safeRate = clamp(rate, 0.7, 1.2, 0.94);
  const words = message ? message.split(/\s+/).filter(Boolean).length : 0;
  const punctuationPauses = (message.match(/[,.!?;:]/g) || []).length * 180;
  const estimatedSpeechMs = (words * 60_000) / (155 * safeRate) + punctuationPauses;
  // Browser voices vary considerably. Allow roughly twice the normal speaking
  // estimate plus startup/ending slack, while still bounding a stuck utterance.
  return Math.round(clamp(estimatedSpeechMs * 2 + 3_000, 7_000, 90_000, 7_000));
}

export class AudioEngine {
  constructor({ onStatus = () => {}, onPlayback = () => {} } = {}) {
    this.onStatus = onStatus;
    this.onPlayback = onPlayback;
    this.context = null;
    this.musicBus = null;
    this.musicAnalyser = null;
    this.voiceBus = null;
    this.voiceInput = null;
    this.musicElement = null;
    this.musicElementSource = null;
    this.musicPrimed = false;
    this.musicPrimePromise = null;
    this.musicPrimeUrl = '';
    this.primingMusic = false;
    this.musicLevel = MUSIC_LEVEL_PERCENT / 100;
    this.duckLevel = DUCK_LEVEL_PERCENT / 100;
    this.voiceLevel = VOICE_LEVEL_PERCENT / 100;
    this.unlocked = false;
    this.currentLabel = '';
    this.currentUrl = '';
    this.currentTrackIndex = 0;
    this.builtInBed = null;
    this.voiceSource = null;
    this.voiceCancel = null;
    this.speechCancel = null;
    this.announcementDepth = 0;
  }

  status() {
    return {
      supported: !!audioContextConstructor(),
      unlocked: this.unlocked,
      contextState: this.context?.state || 'not-created',
      musicLevelPercent: Math.round(this.musicLevel * 100),
      voiceLevelPercent: VOICE_LEVEL_PERCENT,
      duckLevelPercent: Math.round(this.duckLevel * 100),
      musicPlaying: this.musicPlaying(),
      label: this.currentLabel,
      url: this.currentUrl
    };
  }

  report(message, ok = true) {
    this.onStatus({ message, ok, ...this.status() });
  }

  ensureGraph() {
    if (this.context) return this.context;
    const AudioContext = audioContextConstructor();
    if (!AudioContext) throw new Error('This browser does not provide Web Audio. Use a current Safari, Chrome, Edge, or Firefox browser.');
    const context = new AudioContext({ latencyHint: 'playback' });
    const musicBus = context.createGain();
    const musicAnalyser = context.createAnalyser();
    musicAnalyser.fftSize = 1024;
    musicAnalyser.smoothingTimeConstant = 0.2;
    const musicLimiter = context.createDynamicsCompressor();
    musicLimiter.threshold.value = -1.5;
    musicLimiter.knee.value = 0;
    musicLimiter.ratio.value = 20;
    musicLimiter.attack.value = 0.003;
    musicLimiter.release.value = 0.18;
    musicBus.gain.value = this.musicLevel;
    musicBus.connect(musicAnalyser).connect(musicLimiter).connect(context.destination);

    const voiceInput = context.createGain();
    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 90;
    highPass.Q.value = 0.7;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2800;
    presence.Q.value = 0.85;
    presence.gain.value = 2.2;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const voiceBus = context.createGain();
    voiceBus.gain.value = this.voiceLevel;
    voiceInput.connect(highPass).connect(presence).connect(compressor).connect(limiter).connect(voiceBus).connect(context.destination);

    this.context = context;
    this.musicBus = musicBus;
    this.musicAnalyser = musicAnalyser;
    this.voiceInput = voiceInput;
    this.voiceBus = voiceBus;
    return context;
  }

  async unlock({ audibleTest = false } = {}) {
    const context = this.ensureGraph();
    // Start the real HTMLMediaElement inside the receiver tap call stack. This
    // preserves the user-activation grant Safari/iOS requires when a scheduled
    // track is loaded later, while sending only silent PCM through the current
    // music bus target.
    const mediaPrime = this.primeMusicElement();
    const contextResume = context.state === 'running'
      ? Promise.resolve(true)
      : withTimeout(
          context.resume(),
          5_000,
          'Receiver audio did not start. Keep this page visible, check the browser sound permission, and tap Start Receiver again.'
        );
    await Promise.all([contextResume, mediaPrime]);
    if (context.state !== 'running') throw new Error(`Receiver audio is ${context.state}. Tap Start Receiver again while this page is visible.`);
    this.unlocked = true;
    if (audibleTest) await this.playUnlockTone();
    this.report(`Receiver mixer ready: music is set to ${Math.round(this.musicLevel * 100)}% and announcements to 100%.`, true);
    return true;
  }

  async playUnlockTone() {
    const context = this.ensureGraph();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    oscillator.connect(gain).connect(this.voiceInput);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
    await wait(340);
  }

  getMusicElement() {
    if (this.musicElement) return this.musicElement;
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10000px;top:-10000px;';
    document.body.appendChild(audio);
    this.musicElement = audio;
    const context = this.ensureGraph();
    this.musicElementSource = context.createMediaElementSource(audio);
    this.musicElementSource.connect(this.musicBus);
    audio.addEventListener('playing', () => {
      if (!this.primingMusic) this.onPlayback({ type: 'playing', label: this.currentLabel, url: this.currentUrl });
    });
    audio.addEventListener('pause', () => {
      if (!this.primingMusic) this.onPlayback({ type: 'paused', label: this.currentLabel, url: this.currentUrl });
    });
    audio.addEventListener('ended', () => this.onPlayback({ type: 'ended', label: this.currentLabel, url: this.currentUrl }));
    audio.addEventListener('error', () => this.onPlayback({ type: 'error', label: this.currentLabel, url: this.currentUrl, error: audio.error?.message || 'Audio media error' }));
    return audio;
  }

  primeMusicElement() {
    if (this.musicPrimed) return Promise.resolve(true);
    if (this.musicPrimePromise) return this.musicPrimePromise;
    const audio = this.getMusicElement();
    if (this.currentUrl && audio.src) {
      this.musicPrimed = true;
      return Promise.resolve(true);
    }
    this.primingMusic = true;
    this.musicPrimeUrl = URL.createObjectURL(silentPrimeBlob());
    audio.src = this.musicPrimeUrl;
    audio.loop = false;
    audio.muted = false;
    audio.volume = 1;
    audio.load();
    let playResult;
    try {
      playResult = audio.play();
    } catch (error) {
      this.primingMusic = false;
      throw error;
    }
    this.musicPrimePromise = withTimeout(
      Promise.resolve(playResult),
      5_000,
      'The browser did not unlock scheduled music. Keep this page visible and tap Start Receiver again.'
    ).then(() => {
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      this.musicPrimed = true;
      return true;
    }).finally(() => {
      this.primingMusic = false;
      this.musicPrimePromise = null;
    });
    return this.musicPrimePromise;
  }

  releaseMusicPrime() {
    if (!this.musicPrimeUrl) return;
    try { URL.revokeObjectURL(this.musicPrimeUrl); } catch {}
    this.musicPrimeUrl = '';
  }

  setMusicBus(level, rampMs = 180) {
    const context = this.ensureGraph();
    const target = clamp(level, 0, 1, this.musicLevel);
    const now = context.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(target, now + Math.max(0.01, rampMs / 1000));
  }

  setMusicLevelPercent(percent, { rampMs = 140, report = true } = {}) {
    const targetPercent = clamp(percent, 0, 100, MUSIC_LEVEL_PERCENT);
    this.musicLevel = targetPercent / 100;
    this.duckLevel = Math.min(DUCK_LEVEL_PERCENT, targetPercent) / 100;
    if (this.musicBus) {
      const audibleTarget = this.announcementDepth > 0 ? this.duckLevel : this.musicLevel;
      this.setMusicBus(audibleTarget, rampMs);
    }
    if (report) this.report(`Music target set to ${targetPercent}%. Announcements remain fixed at 100%.`, true);
    return targetPercent;
  }

  async verifyMusicSignal(timeoutMs = 4_000) {
    if (!this.musicAnalyser) return false;
    const samples = new Float32Array(this.musicAnalyser.fftSize);
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      this.musicAnalyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
      if (peak > 0.00001) return true;
      await wait(120);
    }
    return false;
  }

  async playMusicUrl(url, { label = 'Suno / direct audio', loop = false, startAt = 0 } = {}) {
    if (!this.unlocked) throw new Error('Start Receiver before playing music.');
    const raw = String(url || '').trim();
    if (!/^https:\/\//i.test(raw)) throw new Error('Music needs a secure HTTPS Suno or direct audio URL.');
    this.stopBuiltInBed();
    const audio = this.getMusicElement();
    const changed = audio.src !== raw;
    if (changed) {
      audio.pause();
      this.releaseMusicPrime();
      audio.src = raw;
      audio.load();
    }
    audio.loop = !!loop;
    audio.muted = false;
    audio.volume = 1;
    this.currentUrl = raw;
    this.currentLabel = String(label || 'Suno / direct audio');
    this.setMusicBus(this.musicLevel, 80);
    if (!changed && !audio.paused && !audio.ended) {
      this.report(`${this.currentLabel} is already playing through the exact ${Math.round(this.musicLevel * 100)}% music bus.`, true);
      return true;
    }
    if (startAt > 0) {
      if (changed || audio.readyState < 1) {
        await waitFor(audio, 'loadedmetadata', 'error', 12_000, 'The music URL did not load. Confirm that it is public and supports browser playback.');
      }
      audio.currentTime = Math.min(Number(startAt) || 0, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : Number(startAt) || 0);
    }
    await withTimeout(
      Promise.resolve(audio.play()),
      12_000,
      'The music URL could not start through the calibrated mixer. Use a public Suno or CORS-enabled direct audio URL.'
    );
    if (!await this.verifyMusicSignal()) {
      audio.pause();
      throw new Error('The track started, but no audio entered the calibrated mixer. Use a public Suno link or a direct audio host that permits browser audio (CORS).');
    }
    this.report(`${this.currentLabel} is playing through the exact ${Math.round(this.musicLevel * 100)}% music bus.`, true);
    return true;
  }

  musicPlaying() {
    return !!this.builtInBed || (!!this.musicElement && !this.musicElement.paused && !this.musicElement.ended);
  }

  pauseMusic() {
    let changed = false;
    if (this.musicElement && !this.musicElement.paused) {
      this.musicElement.pause();
      changed = true;
    }
    if (this.builtInBed) {
      this.builtInBed.stop();
      this.builtInBed = null;
      changed = true;
    }
    if (changed) this.report('Music paused.', true);
    return changed;
  }

  async resumeMusic() {
    if (!this.currentUrl || !this.musicElement?.src || this.musicElement.src === this.musicPrimeUrl) return false;
    const context = this.ensureGraph();
    if (context.state !== 'running') {
      await withTimeout(context.resume(), 5_000, 'The receiver mixer did not resume. Keep this page visible and tap Start Receiver again.');
    }
    if (context.state !== 'running') throw new Error(`Receiver audio is ${context.state}; music stayed paused.`);
    this.setMusicBus(this.musicLevel, 120);
    await withTimeout(Promise.resolve(this.musicElement.play()), 12_000, 'The paused track could not resume through the calibrated mixer.');
    if (!await this.verifyMusicSignal()) {
      this.musicElement.pause();
      throw new Error('The track resumed, but no audio entered the calibrated mixer. Music was paused instead of reporting a false playing state.');
    }
    this.report(`${this.currentLabel || 'Music'} resumed at ${Math.round(this.musicLevel * 100)}%.`, true);
    return true;
  }

  stopMusic() {
    const changed = this.pauseMusic();
    if (this.musicElement) {
      try { this.musicElement.currentTime = 0; } catch {}
    }
    this.currentLabel = '';
    this.currentUrl = '';
    this.report('Music stopped.', true);
    return changed;
  }

  playBuiltInBed({ label = 'Receiver calibration bed' } = {}) {
    if (!this.unlocked) throw new Error('Start Receiver before playing the calibration bed.');
    this.stopMusic();
    const context = this.ensureGraph();
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(this.musicBus);
    const frequencies = [196, 246.94, 293.66, 392];
    const oscillators = frequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index < 2 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.value = index < 2 ? 0.11 : 0.035;
      oscillator.connect(gain).connect(master);
      oscillator.start();
      return { oscillator, gain };
    });
    const playback = {
      stop: () => {
        oscillators.forEach(({ oscillator, gain }) => {
          try { oscillator.stop(); } catch {}
          try { oscillator.disconnect(); gain.disconnect(); } catch {}
        });
        try { master.disconnect(); } catch {}
      }
    };
    this.builtInBed = playback;
    this.currentLabel = label;
    this.currentUrl = 'poolside://calibration-bed';
    this.setMusicBus(this.musicLevel, 120);
    this.report(`${label} is playing through the exact ${Math.round(this.musicLevel * 100)}% music bus.`, true);
    return true;
  }

  stopBuiltInBed() {
    if (!this.builtInBed) return false;
    try { this.builtInBed.stop(); } catch {}
    this.builtInBed = null;
    return true;
  }

  async beginAnnouncement() {
    this.announcementDepth += 1;
    if (this.announcementDepth > 1) return;
    this.setMusicBus(this.duckLevel, 320);
    await wait(380);
  }

  async endAnnouncement({ restore = true } = {}) {
    this.announcementDepth = Math.max(0, this.announcementDepth - 1);
    if (this.announcementDepth > 0) return;
    if (!restore) return;
    await wait(220);
    this.setMusicBus(this.musicLevel, 450);
  }

  async playVoiceBlob(blob) {
    if (!this.unlocked) throw new Error('Start Receiver before playing announcements.');
    const context = this.ensureGraph();
    const bytes = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const source = context.createBufferSource();
    const normalizer = context.createGain();
    normalizer.gain.value = normalizedVoiceGain(buffer);
    source.buffer = buffer;
    source.connect(normalizer).connect(this.voiceInput);
    this.voiceSource = source;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let cancelVoice = null;
      const cleanup = () => {
        clearTimeout(timeout);
        if (this.voiceCancel === cancelVoice) this.voiceCancel = null;
        if (this.voiceSource === source) this.voiceSource = null;
        try { source.disconnect(); normalizer.disconnect(); } catch {}
      };
      cancelVoice = (message = 'Announcement audio was cancelled before completion.') => {
        if (settled) return;
        settled = true;
        cleanup();
        try { source.stop(); } catch {}
        reject(new Error(message));
      };
      this.voiceCancel = cancelVoice;
      const timeout = setTimeout(() => {
        cancelVoice('Announcement audio did not complete. Tap Start Receiver again.');
      }, Math.max(6_000, Math.ceil(buffer.duration * 1000) + 5_000));
      source.onended = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      try {
        source.start();
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  }

  async playDeviceSpeech(text, { rate = 0.94, pitch = 1 } = {}) {
    if (!('speechSynthesis' in globalThis)) throw new Error('This browser does not provide device speech.');
    const message = String(text || '').trim();
    if (!message) throw new Error('Announcement text is empty.');
    return await new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = clamp(rate, 0.7, 1.2, 0.94);
      utterance.pitch = clamp(pitch, 0.7, 1.3, 1);
      utterance.volume = 1;
      let settled = false;
      let completionTimer = null;
      const cleanup = () => {
        clearTimeout(startTimer);
        if (completionTimer) clearTimeout(completionTimer);
        if (this.speechCancel === cancelSpeech) this.speechCancel = null;
      };
      const fail = (error, { cancel = false } = {}) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancel) {
          try { globalThis.speechSynthesis.cancel(); } catch {}
        }
        reject(error);
      };
      const startTimer = setTimeout(() => {
        fail(new Error('Device speech did not start. Tap Start Receiver again while this page is visible.'), { cancel: true });
      }, 4_000);
      const cancelSpeech = () => fail(new Error('Device speech was cancelled before completion.'), { cancel: true });
      this.speechCancel = cancelSpeech;
      utterance.onstart = () => {
        if (settled) return;
        clearTimeout(startTimer);
        completionTimer = setTimeout(() => {
          fail(new Error('Device speech did not complete. Tap Start Receiver again while this page is visible.'), { cancel: true });
        }, estimateDeviceSpeechTimeoutMs(message, utterance.rate));
      };
      utterance.onend = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      utterance.onerror = event => {
        fail(new Error(event?.error || 'Device speech failed.'));
      };
      try {
        globalThis.speechSynthesis.cancel();
        globalThis.speechSynthesis.speak(utterance);
      } catch (error) {
        fail(error);
      }
    });
  }

  stopVoice(reason = 'Announcement audio was cancelled before completion.') {
    if (this.voiceCancel) {
      this.voiceCancel(reason);
    } else if (this.voiceSource) {
      try { this.voiceSource.stop(); } catch {}
      this.voiceSource = null;
    }
    if (this.speechCancel) this.speechCancel();
    if ('speechSynthesis' in globalThis) {
      try { speechSynthesis.cancel(); } catch {}
    }
  }

  async runCalibration({ speak = null } = {}) {
    await this.unlock({ audibleTest: true });
    const targetPercent = Math.round(this.musicLevel * 100);
    this.playBuiltInBed({ label: `${targetPercent}% calibration bed` });
    try {
      await wait(1_100);
      await this.beginAnnouncement();
      try {
        const message = `Poolside Pulse sound check. Music is at ${targetPercent} percent. This announcement is at one hundred percent.`;
        if (typeof speak === 'function') await speak(message);
        else await this.playDeviceSpeech(message);
      } finally {
        await this.endAnnouncement();
      }
    } finally {
      this.stopBuiltInBed();
    }
    return true;
  }

  destroy() {
    this.stopVoice();
    this.stopMusic();
    if (this.musicElement) {
      try { this.musicElement.remove(); } catch {}
      this.musicElement = null;
    }
    this.releaseMusicPrime();
    if (this.context) {
      try { this.context.close(); } catch {}
      this.context = null;
    }
    this.unlocked = false;
  }
}
