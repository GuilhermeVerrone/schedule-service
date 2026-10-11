import type { WhatsAppConnection } from "@/generated/prisma/client";
import type { TenantRepository } from "@/server/repositories/tenant-repository";
import {
  isWhatsAppError,
  type ConnectionState,
  type PairingQr,
  type SessionSnapshot,
  type WhatsAppProvider,
} from "@/server/whatsapp";

// Conexão do WhatsApp do dono (guia 3, 7a, 7b, 7e): conectar por QR, ver o estado, reconectar e
// desconectar. O tenant vem só do repositório (sessão do painel); o provider só recebe o sessionId
// gravado na conexão do próprio tenant. O estado do provedor é copiado para o banco a cada
// consulta (última checagem), e o webhook de conexão também o atualiza (D3, D8).

export class AlreadyConnectedError extends Error {
  constructor() {
    super("WhatsApp já conectado");
    this.name = "AlreadyConnectedError";
  }
}

export class NoConnectionError extends Error {
  constructor() {
    super("Nenhuma conexão do WhatsApp");
    this.name = "NoConnectionError";
  }
}

export interface ConnectionView {
  status: ConnectionState;
  lastCheckedAt: Date | null;
  // Só em "qr_pending". Sensível: a rota responde sem cache.
  qr: PairingQr | null;
  // false quando o provedor não respondeu e o estado é o último gravado.
  live: boolean;
}

const view = (connection: WhatsAppConnection, qr: PairingQr | null, live: boolean): ConnectionView => ({
  status: connection.status as ConnectionState,
  lastCheckedAt: connection.lastCheckedAt,
  qr: connection.status === "qr_pending" ? qr : null,
  live,
});

// Erros em que o provedor não tem a sessão (memória do Fake perdida, sessão apagada no provedor):
// a conexão é tratada como desconectada e conectar de novo abre outra sessão.
const isUnknownSession = (error: unknown): boolean => isWhatsAppError(error, "unknown_session");

async function saveSnapshot(repo: TenantRepository, snapshot: SessionSnapshot): Promise<ConnectionView> {
  const connection = await repo.whatsappConnection.save({
    sessionId: snapshot.sessionId,
    status: snapshot.state,
    checkedAt: snapshot.checkedAt,
  });
  return view(connection, snapshot.qr, true);
}

// Abre a sessão (nova ou a mesma) e grava o estado devolvido, com o QR a ler.
async function pair(repo: TenantRepository, provider: WhatsAppProvider, sessionId?: string): Promise<ConnectionView> {
  if (sessionId) {
    try {
      return await saveSnapshot(repo, await provider.connect({ sessionId }));
    } catch (error) {
      if (!isUnknownSession(error)) throw error;
    }
  }
  return saveSnapshot(repo, await provider.connect());
}

export async function getConnectionStatus(
  repo: TenantRepository,
  provider: WhatsAppProvider,
): Promise<ConnectionView | null> {
  const connection = await repo.whatsappConnection.get();
  if (!connection) return null;
  try {
    const snapshot = await provider.getStatus(connection.sessionId);
    const updated = await repo.whatsappConnection.setStatus(snapshot.state, snapshot.checkedAt);
    return updated ? view(updated, snapshot.qr, true) : null;
  } catch (error) {
    if (isUnknownSession(error)) {
      const updated = await repo.whatsappConnection.setStatus("disconnected");
      return updated ? view(updated, null, true) : null;
    }
    // Provedor fora do ar ou não configurado: devolve o último estado gravado.
    if (isWhatsAppError(error)) return view(connection, null, false);
    throw error;
  }
}

// Primeira conexão, ou nova leitura de QR depois de desconectar.
export async function connectWhatsApp(repo: TenantRepository, provider: WhatsAppProvider): Promise<ConnectionView> {
  const current = await getConnectionStatus(repo, provider);
  if (current?.status === "connected") throw new AlreadyConnectedError();
  const connection = await repo.whatsappConnection.get();
  return pair(repo, provider, connection?.sessionId);
}

// Depois de uma queda (ou suspeita de banimento): retoma a mesma sessão com um QR novo.
export async function reconnectWhatsApp(repo: TenantRepository, provider: WhatsAppProvider): Promise<ConnectionView> {
  const current = await getConnectionStatus(repo, provider);
  if (!current) throw new NoConnectionError();
  if (current.status === "connected") throw new AlreadyConnectedError();
  const connection = await repo.whatsappConnection.get();
  if (!connection) throw new NoConnectionError();
  return pair(repo, provider, connection.sessionId);
}

// Encerra a sessão no provedor e marca a conexão como desconectada. Repetir não é erro.
export async function disconnectWhatsApp(repo: TenantRepository, provider: WhatsAppProvider): Promise<ConnectionView> {
  const connection = await repo.whatsappConnection.get();
  if (!connection) throw new NoConnectionError();
  try {
    await provider.disconnect(connection.sessionId);
  } catch (error) {
    if (!isUnknownSession(error)) throw error;
  }
  const updated = await repo.whatsappConnection.setStatus("disconnected");
  if (!updated) throw new NoConnectionError();
  return view(updated, null, true);
}
