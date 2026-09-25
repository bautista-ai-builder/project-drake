import pcmWorkletUrl from "./pcm-worklet.ts?worker&url";

export interface CaptureChunk {
  pcm: Int16Array;
  level: number;
}

export class MicrophoneCapture {
  private context: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private node: AudioWorkletNode | undefined;

  async start(onChunk: (chunk: CaptureChunk) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule(pcmWorkletUrl);
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "drake-pcm");
    const silent = this.context.createGain();
    silent.gain.value = 0;
    this.node.port.onmessage = (event: MessageEvent<CaptureChunk & { type: string }>) => {
      if (event.data.type === "pcm") onChunk({ pcm: event.data.pcm, level: event.data.level });
    };
    source.connect(this.node).connect(silent).connect(this.context.destination);
  }

  async stop(): Promise<void> {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.node = undefined;
    this.stream = undefined;
    this.context = undefined;
  }
}
