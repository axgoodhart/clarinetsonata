export class AudioPlayer {
  private audioCtx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: AudioBuffer | null = null;
  private gainNode: GainNode | null = null;
  private frequencyData: Uint8Array = new Uint8Array(0);
  private _startedAt = 0;
  private _pausedAt = 0;
  private _isPlaying = false;

  get isPlaying() {
    return this._isPlaying;
  }

  get currentTime() {
    if (!this._isPlaying || !this.audioCtx) return this._pausedAt;
    return this.audioCtx.currentTime - this._startedAt + this._pausedAt;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get loaded() {
    return this.buffer !== null;
  }

  get audioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  private ensureContext() {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  private setupAnalyser() {
    const ctx = this.ensureContext();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.gainNode = ctx.createGain();
    this.analyser.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);
  }

  async loadFile(file: File) {
    const ctx = this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
    this.setupAnalyser();
    this._pausedAt = 0;
  }

  async loadUrl(url: string) {
    const ctx = this.ensureContext();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
    this.setupAnalyser();
    this._pausedAt = 0;
  }

  play() {
    if (!this.audioCtx || !this.buffer || !this.analyser || this._isPlaying)
      return;

    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }

    this.source = this.audioCtx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.analyser);
    this.source.start(0, this._pausedAt);
    this._startedAt = this.audioCtx.currentTime;
    this._isPlaying = true;

    this.source.onended = () => {
      if (this._isPlaying) {
        this._pausedAt = 0;
        this._isPlaying = false;
      }
    };
  }

  pause() {
    if (!this._isPlaying || !this.source) return;
    this.source.onended = null;
    this.source.stop();
    this._pausedAt = this.currentTime;
    this._isPlaying = false;
  }

  toggle() {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  seek(time: number) {
    const wasPlaying = this._isPlaying;
    if (wasPlaying) {
      if (this.source) this.source.onended = null;
      this.source?.stop();
      this._isPlaying = false;
    }
    this._pausedAt = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) {
      this.play();
    }
  }

  getFFT(): { bass: number; mid: number; high: number } {
    if (!this.analyser || !this._isPlaying)
      return { bass: 0, mid: 0, high: 0 };

    this.analyser.getByteFrequencyData(this.frequencyData as Uint8Array<ArrayBuffer>);
    const bins = this.frequencyData.length;

    const bassEnd = Math.floor(bins / 6);
    const midEnd = Math.floor(bins / 2);

    let bass = 0,
      mid = 0,
      high = 0;
    for (let i = 0; i < bins; i++) {
      const v = this.frequencyData[i] / 255;
      if (i < bassEnd) bass += v;
      else if (i < midEnd) mid += v;
      else high += v;
    }

    bass /= bassEnd;
    mid /= midEnd - bassEnd;
    high /= bins - midEnd;

    return { bass, mid, high };
  }
}
