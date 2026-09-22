import { EventEmitter } from "events";

const g = globalThis as unknown as { __sd_bus?: EventEmitter };

export const bus: EventEmitter =
  g.__sd_bus ?? (g.__sd_bus = new EventEmitter().setMaxListeners(200));

export function publish(channel: string, event: unknown) {
  bus.emit(channel, JSON.stringify(event));
}

export function subscribe(
  channel: string,
  listener: (data: string) => void,
): () => void {
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}
