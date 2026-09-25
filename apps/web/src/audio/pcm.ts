export const floatToPcm16 = (value: number): number => {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
};

export class StreamingPcm16Resampler {
  private source: number[] = [];
  private cursor = 0;

  constructor(private readonly inputRate: number, private readonly outputRate = 16_000) {
    if (inputRate < outputRate) throw new Error("Input sample rate must be at least the target sample rate");
  }

  push(input: Float32Array): Int16Array {
    this.source.push(...input);
    const ratio = this.inputRate / this.outputRate;
    const output: number[] = [];
    while (this.cursor + ratio <= this.source.length) {
      const from = Math.floor(this.cursor);
      const to = Math.max(from + 1, Math.floor(this.cursor + ratio));
      let sum = 0;
      for (let index = from; index < to; index += 1) sum += this.source[index] ?? 0;
      output.push(floatToPcm16(sum / (to - from)));
      this.cursor += ratio;
    }
    const consumed = Math.floor(this.cursor);
    if (consumed > 0) {
      this.source.splice(0, consumed);
      this.cursor -= consumed;
    }
    return Int16Array.from(output);
  }
}
