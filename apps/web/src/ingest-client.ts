import { encodeAudioFrame, ingestServerMessageSchema } from "@drake/contracts";
import { MicrophoneCapture } from "./audio/capture.js";

export type IngestState = "idle" | "connecting" | "live" | "error";

export class IngestClient {
  private socket: WebSocket | undefined;
  private readonly capture = new MicrophoneCapture();
  private readonly captureSessionId = crypto.randomUUID();
  private sequence = 0;
  private sampleOffset = 0;
  private lastServerAck = 0;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private capturing = false;
  private readonly ring: Array<{ startSample: number; endSample: number; frame: ArrayBuffer }> = [];

  constructor(
    private readonly stageId: string,
    private readonly talkId: string,
    private readonly sourceLanguage: string,
    private readonly onState: (state: IngestState, detail?: string) => void,
    private readonly onLevel: (level: number) => void,
  ) {}

  async start(): Promise<void> {
    this.stopping = false;
    this.onState("connecting", "Requesting secure ingest connection");
    await this.connect();
    if (!this.capturing) {
      await this.capture.start(({ pcm, level }) => {
        this.onLevel(level);
        const frame = encodeAudioFrame(
          { protocolVersion: 1, frameSequence: this.sequence++, startSample: this.sampleOffset, sampleCount: pcm.length }, pcm,
        );
        const startSample = this.sampleOffset;
        this.sampleOffset += pcm.length;
        this.ring.push({ startSample, endSample: this.sampleOffset, frame });
        while (this.ring[0] && this.ring[0].endSample < this.sampleOffset - 160_000) this.ring.shift();
        if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 1_000_000) this.socket.send(frame);
      });
      this.capturing = true;
    }
    this.onState("live", "PCM16 · 16 kHz · mono");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "ingest.stop", reason: "operator_stop", finalSampleOffset: this.sampleOffset }));
    }
    if (this.capturing) await this.capture.stop();
    this.capturing = false;
    this.socket?.close(1000, "operator_stop");
    this.socket = undefined;
    this.onState("idle", "Stopped by operator");
  }

  private async connect(): Promise<void> {
    const response = await fetch("/api/ingest-token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ conferenceId: "nerdearla-2026", stageId: this.stageId, talkId: this.talkId }),
    });
    if (!response.ok) throw new Error(`Token request failed (${response.status})`);
    const { token } = await response.json() as { token: string };
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/ingest/${this.stageId}?token=${encodeURIComponent(token)}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) { settled = true; reject(error); }
      };
      socket.onopen = () => socket.send(JSON.stringify({
        type: "ingest.hello", protocolVersion: 1, talkId: this.talkId, sourceLanguage: this.sourceLanguage,
        codec: "pcm_s16le", sampleRate: 16_000, channels: 1, captureSessionId: this.captureSessionId,
        startingSampleOffset: this.sampleOffset,
      }));
      socket.onmessage = (event) => {
        const message = ingestServerMessageSchema.parse(JSON.parse(String(event.data)));
        if (message.type === "ingest.ready") {
          socket.send(JSON.stringify({
            type: "ingest.resume", captureSessionId: this.captureSessionId,
            availableFromSample: this.ring[0]?.startSample ?? this.sampleOffset,
            availableToSample: this.sampleOffset, lastServerAck: this.lastServerAck,
          }));
        }
        if (message.type === "ingest.resume_from") {
          for (const item of this.ring) if (item.startSample >= message.sampleOffset) socket.send(item.frame);
          this.lastServerAck = Math.max(this.lastServerAck, message.sampleOffset);
          this.reconnectAttempt = 0;
          if (!settled) { settled = true; resolve(); }
        }
        if (message.type === "ingest.ack") this.lastServerAck = Math.max(this.lastServerAck, message.acceptedThroughSample);
        if (message.type === "ingest.error") fail(new Error(message.detail));
      };
      socket.onerror = () => fail(new Error("WebSocket connection failed"));
      socket.onclose = () => {
        if (!settled) fail(new Error("Connection closed before ingest was ready"));
        if (!this.stopping) this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(3_000, 300 * 2 ** this.reconnectAttempt++);
    this.onState("connecting", `Reconnecting in ${delay} ms · audio buffered locally`);
    this.reconnectTimer = setTimeout(() => {
      void this.connect()
        .then(() => this.onState("live", "Reconnected · buffered audio replayed"))
        .catch(() => this.scheduleReconnect());
    }, delay);
  }
}
