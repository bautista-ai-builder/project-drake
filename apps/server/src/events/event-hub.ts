import type { CanonicalEvent } from "@drake/contracts";

export type EventSubscriber = (event: CanonicalEvent) => void | Promise<void>;

export class EventHub {
  private readonly subscribers = new Set<EventSubscriber>();
  private readonly recentDurable: CanonicalEvent[] = [];
  private readonly partials = new Map<string, CanonicalEvent>();

  constructor(private readonly durableLimit = 1_000) {}

  publish(event: CanonicalEvent): void {
    if (event.type === "transcript.partial") {
      this.partials.set(`${event.talkId}:${event.segmentId}`, event);
    } else {
      this.recentDurable.push(event);
      if (this.recentDurable.length > this.durableLimit) this.recentDurable.shift();
      if ("segmentId" in event && event.segmentId) this.partials.delete(`${event.talkId}:${event.segmentId}`);
    }

    for (const subscriber of this.subscribers) {
      Promise.resolve(subscriber(event)).catch(() => undefined);
    }
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  snapshot(talkId: string): CanonicalEvent[] {
    return [
      ...this.recentDurable.filter((event) => event.talkId === talkId),
      ...[...this.partials.values()].filter((event) => event.talkId === talkId),
    ].sort((a, b) => a.sequence - b.sequence);
  }
}
