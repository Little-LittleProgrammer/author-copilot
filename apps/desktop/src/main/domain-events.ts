import type { DocumentSavedEvent } from "./project/index.js";

export type DesktopDomainEvent = DocumentSavedEvent;
export type DesktopDomainEventListener = (
  event: DesktopDomainEvent,
) => void | Promise<void>;

export class DesktopDomainEvents {
  private readonly listeners = new Set<DesktopDomainEventListener>();

  subscribe(listener: DesktopDomainEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish = (event: DesktopDomainEvent): void => {
    for (const listener of this.listeners) {
      queueMicrotask(() => {
        Promise.resolve(listener(event)).catch(() => undefined);
      });
    }
  };
}
