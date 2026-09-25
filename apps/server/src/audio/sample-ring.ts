export interface AudioChunk {
  startSample: number;
  pcm: Int16Array;
}

export class SampleRingBuffer {
  readonly capacitySamples: number;
  private chunks: AudioChunk[] = [];

  constructor(sampleRate: number, seconds: number) {
    this.capacitySamples = sampleRate * seconds;
  }

  append(chunk: AudioChunk): void {
    if (chunk.pcm.length === 0) return;
    this.chunks.push({ startSample: chunk.startSample, pcm: chunk.pcm.slice() });
    const newestEnd = chunk.startSample + chunk.pcm.length;
    const retainFrom = Math.max(0, newestEnd - this.capacitySamples);
    this.chunks = this.chunks.filter((item) => item.startSample + item.pcm.length > retainFrom);
  }

  range(fromSample: number, toSample: number): AudioChunk[] {
    return this.chunks
      .filter((item) => item.startSample < toSample && item.startSample + item.pcm.length > fromSample)
      .map((item) => ({ startSample: item.startSample, pcm: item.pcm.slice() }));
  }

  get availableFromSample(): number | undefined {
    return this.chunks[0]?.startSample;
  }
}
