import type { Handler, InboundMessage, StatusUpdate, Unsubscribe, WhatsAppEvent } from "./types";

// Inscrições dos handlers, comum a todos os providers. Os handlers rodam em ordem e o erro de
// um deles sobe: o webhook processa no mesmo request (D3) e, se falhar, o provedor reenvia e a
// idempotência cobre.
export class EventHub {
  private readonly inbound = new Set<Handler<InboundMessage>>();
  private readonly status = new Set<Handler<StatusUpdate>>();

  onInboundMessage(handler: Handler<InboundMessage>): Unsubscribe {
    this.inbound.add(handler);
    return () => this.inbound.delete(handler);
  }

  onStatusUpdate(handler: Handler<StatusUpdate>): Unsubscribe {
    this.status.add(handler);
    return () => this.status.delete(handler);
  }

  async emit(event: WhatsAppEvent): Promise<void> {
    if (event.kind === "inbound_message") {
      for (const handler of [...this.inbound]) await handler(event);
      return;
    }
    for (const handler of [...this.status]) await handler(event);
  }
}
