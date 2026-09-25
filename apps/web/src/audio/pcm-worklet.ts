import { StreamingPcm16Resampler } from "./pcm.js";

declare const sampleRate: number;
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}

class DrakePcmProcessor extends AudioWorkletProcessor {
  private readonly resampler = new StreamingPcm16Resampler(sampleRate);
  private pending: number[] = [];

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const pcm = this.resampler.push(channel);
    this.pending.push(...pcm);
    while (this.pending.length >= 1_600) {
      const chunk = Int16Array.from(this.pending.splice(0, 1_600));
      let peak = 0;
      for (const value of chunk) peak = Math.max(peak, Math.abs(value) / 32_768);
      this.port.postMessage({ type: "pcm", pcm: chunk, level: peak }, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor("drake-pcm", DrakePcmProcessor);
