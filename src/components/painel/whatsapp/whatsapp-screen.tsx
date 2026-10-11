"use client";

import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleOffIcon, InfoIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PageFrame, PageHead } from "@/components/painel/catalog/page-head";
import { LoadError } from "@/components/painel/catalog/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QrCode } from "./qr-code";
import { SendUsageSection } from "./send-usage-section";
import { useConnection } from "./use-connection";
import { runConnectionAction, type ConnectionAction, type ConnectionDto, type ConnectionStatus, type PairingQrDto } from "./whatsapp-api";

// /painel/whatsapp (guia 3, 7a, 7b, 7e): conectar lendo o QR, ver o estado, alerta de queda,
// reconectar e desconectar, com o aviso de risco do WhatsApp não oficial sempre à vista.
// Celular: uma coluna (estado, depois os cuidados). Desktop: estado nas colunas 1 a 7 e os
// cuidados nas 8 a 12. Nenhuma tela desta fatia envia mensagem (D5). Abaixo, o bloco só leitura
// de uso do dia, aquecimento e envios bloqueados (fila-envio-limites-elegibilidade, D6).

const PANEL = "rounded-frame border border-line bg-surface p-[clamp(1.25rem,1rem+1.2vw,2rem)]";

export function WhatsAppScreen() {
  const { state, reload, replace, refresh } = useConnection();
  const [busy, setBusy] = useState<ConnectionAction | null>(null);
  // Desconectou por aqui: o estado "desconectado" é escolha do dono, não queda.
  const [byOwner, setByOwner] = useState(false);

  async function run(action: ConnectionAction) {
    setBusy(action);
    const result = await runConnectionAction(action);
    setBusy(null);
    if (result.ok) {
      setByOwner(action === "disconnect");
      replace(result.data);
      if (action === "disconnect") toast.success("WhatsApp desconectado.");
      return;
    }
    // Outra aba (ou o celular) já mudou o estado: mostra o atual em vez do erro.
    if (result.code === "already_connected" || result.status === 404) void refresh();
    else toast.error(result.message);
  }

  return (
    <PageFrame>
      <PageHead
        title="WhatsApp"
        lead="Conecte o WhatsApp do negócio para as mensagens dos clientes chegarem ao Slotz."
      />
      <div className="mt-head-gap grid gap-6 lg:grid-cols-12 lg:items-start">
        <section aria-labelledby="whatsapp-estado" className={cn(PANEL, "lg:col-span-7")}>
          {state.status === "loading" && <ConnectionSkeleton />}
          {state.status === "error" && (
            <>
              <h2 id="whatsapp-estado" className="sr-only">
                Situação da conexão
              </h2>
              <LoadError message={state.message} onRetry={() => void reload()} />
            </>
          )}
          {state.status === "ready" && (
            <ConnectionPanel
              connection={state.data}
              stale={state.stale}
              byOwner={byOwner}
              busy={busy}
              onAction={(action) => void run(action)}
              onRefresh={refresh}
            />
          )}
        </section>
        <RiskNotice className="lg:col-span-5" />
      </div>
      <SendUsageSection />
    </PageFrame>
  );
}

function ConnectionSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-5">
      <h2 id="whatsapp-estado" className="sr-only">
        Situação da conexão
      </h2>
      <span className="sr-only">Carregando a conexão do WhatsApp…</span>
      <span aria-hidden="true" className="h-chip w-40 animate-pulse rounded-pill bg-tint" />
      <span aria-hidden="true" className="h-6 w-64 max-w-[80%] animate-pulse rounded-sheet bg-tint" />
      <span aria-hidden="true" className="h-4 w-80 max-w-full animate-pulse rounded-sheet bg-tint" />
      <span aria-hidden="true" className="h-control w-48 animate-pulse rounded-control bg-tint" />
    </div>
  );
}

const BADGE: Record<ConnectionStatus, { label: string; icon: ReactNode; className: string }> = {
  not_configured: { label: "Não conectado", icon: <CircleOffIcon />, className: "bg-ink/7 text-ink" },
  qr_pending: { label: "Aguardando leitura", icon: <CircleDashedIcon />, className: "bg-ink/7 text-ink" },
  connected: { label: "Conectado", icon: <CircleCheckIcon />, className: "bg-violet-wash text-violet-deep" },
  disconnected: { label: "Desconectado", icon: <CircleAlertIcon />, className: "bg-danger/8 text-danger" },
  banned_suspected: { label: "Possível bloqueio", icon: <ShieldAlertIcon />, className: "bg-danger/8 text-danger" },
};

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const badge = BADGE[status];
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 self-start rounded-pill px-3 text-micro font-semibold [&_svg]:size-4 [&_svg]:shrink-0",
        badge.className,
      )}
    >
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
}

interface PanelProps {
  connection: ConnectionDto;
  stale: boolean;
  byOwner: boolean;
  busy: ConnectionAction | null;
  onAction: (action: ConnectionAction) => void;
  onRefresh: () => void;
}

function ConnectionPanel({ connection, stale, byOwner, busy, onAction, onRefresh }: PanelProps) {
  const { status } = connection;
  return (
    <div className="flex flex-col gap-6">
      {/* Mudanças de estado (QR lido, queda) chegam pelo polling e são anunciadas aqui. */}
      <div aria-live="polite" className="flex flex-col gap-3">
        <StatusBadge status={status} />
        <h2 id="whatsapp-estado" className="text-title text-ink">
          {TITLE[status](byOwner)}
        </h2>
      </div>

      {status === "not_configured" && <NotConfigured busy={busy} onAction={onAction} />}
      {status === "qr_pending" && connection.qr && (
        <Pairing qr={connection.qr} busy={busy} onAction={onAction} onRefresh={onRefresh} />
      )}
      {status === "qr_pending" && !connection.qr && (
        <p className="text-body text-ink-2">Gerando o código. Ele aparece aqui em instantes.</p>
      )}
      {status === "connected" && <Connected connection={connection} busy={busy} onAction={onAction} />}
      {(status === "disconnected" || status === "banned_suspected") && (
        <Dropped status={status} byOwner={byOwner} busy={busy} onAction={onAction} />
      )}

      {(stale || !connection.live) && (
        <p className="flex items-start gap-2 rounded-control bg-tint px-4 py-3 text-small text-ink-2">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
          {stale
            ? "Sem resposta do servidor agora. Mostramos a última situação e tentamos de novo sozinhos."
            : "Não conseguimos confirmar com o WhatsApp agora. Mostramos a última situação conhecida."}
        </p>
      )}
    </div>
  );
}

const TITLE: Record<ConnectionStatus, (byOwner: boolean) => string> = {
  not_configured: () => "Seu WhatsApp ainda não está conectado",
  qr_pending: () => "Leia o código com o celular do negócio",
  connected: () => "As mensagens dos clientes estão chegando",
  disconnected: (byOwner) => (byOwner ? "Você desconectou o WhatsApp" : "A conexão com o WhatsApp caiu"),
  banned_suspected: () => "O WhatsApp pode ter bloqueado este número",
};

function NotConfigured({ busy, onAction }: Pick<PanelProps, "busy" | "onAction">) {
  return (
    <>
      <p className="max-w-[56ch] text-body text-ink-2">
        Ao conectar, as conversas com os clientes passam a aparecer no Slotz. Antes, leia os{" "}
        <a href="#cuidados">cuidados com o número</a>.
      </p>
      <Button onClick={() => onAction("connect")} disabled={busy !== null} className="w-full sm:w-auto sm:self-start">
        {busy === "connect" ? "Gerando código…" : "Conectar WhatsApp"}
      </Button>
    </>
  );
}

// Relógio de 1 s só enquanto há QR na tela (contagem regressiva da expiração).
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const countdown = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function Pairing({ qr, busy, onAction, onRefresh }: Pick<PanelProps, "busy" | "onAction" | "onRefresh"> & { qr: PairingQrDto }) {
  const now = useNow(true);
  const remaining = new Date(qr.expiresAt).getTime() - now;
  const expired = remaining <= 0;

  // Expirou: pede o estado na hora (o provedor troca o código vencido por um novo).
  useEffect(() => {
    if (expired) onRefresh();
  }, [expired, onRefresh]);

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
      <figure className="flex flex-col items-center gap-3 sm:shrink-0">
        <div className="relative size-[min(15rem,calc(100vw-6rem))] overflow-hidden rounded-control bg-surface p-2 shadow-object ring-1 ring-line">
          <QrCode qr={qr} label="Código QR para conectar o WhatsApp" />
          {expired && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/94 p-4 text-center">
              <p className="text-label text-ink">Código expirado</p>
              <Button size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCwIcon aria-hidden="true" />
                Gerar novo código
              </Button>
            </div>
          )}
        </div>
        <figcaption className="text-micro text-ink-2 tabular-nums" aria-live="off">
          {expired ? "Atualizando o código…" : `O código expira em ${countdown(remaining)}`}
        </figcaption>
      </figure>
      <div className="flex min-w-0 flex-col gap-5">
        <ol className="flex list-none flex-col gap-3 p-0 text-small text-ink">
          {[
            "Abra o WhatsApp no celular do negócio.",
            "Toque em Mais opções (Android) ou Configurações (iPhone) e depois em Dispositivos conectados.",
            "Toque em Conectar dispositivo e aponte a câmera para o código.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-line-strong font-heading text-micro font-semibold tabular-nums"
              >
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <p className="text-small text-ink-2">O código muda sozinho quando expira. Esta tela avisa assim que a leitura der certo.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAction("disconnect")}
          disabled={busy !== null}
          className="w-full sm:w-auto sm:self-start"
        >
          {busy === "disconnect" ? "Cancelando…" : "Cancelar conexão"}
        </Button>
      </div>
    </div>
  );
}

const timeLabel = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : null;

function Connected({ connection, busy, onAction }: Pick<PanelProps, "connection" | "busy" | "onAction">) {
  const [confirming, setConfirming] = useState(false);
  const checked = timeLabel(connection.lastCheckedAt);
  return (
    <>
      <p className="max-w-[56ch] text-body text-ink-2">
        O WhatsApp do negócio está ligado ao Slotz. Mantenha o celular com internet para a conexão não cair.
        {checked && <span className="block pt-1 text-small text-ink-3">Última verificação às {checked}.</span>}
      </p>
      {confirming ? (
        <div role="group" aria-label="Confirmar desconexão" className="flex flex-col gap-4 rounded-control bg-danger/8 p-4">
          <p className="text-small text-ink">
            Desconectar o WhatsApp? As mensagens dos clientes param de chegar ao Slotz até você conectar de novo, lendo um
            novo código.
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy !== null} className="w-full sm:w-auto">
              Voltar
            </Button>
            <Button variant="destructive" onClick={() => onAction("disconnect")} disabled={busy !== null} className="w-full sm:w-auto">
              {busy === "disconnect" ? "Desconectando…" : "Sim, desconectar"}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="destructive" onClick={() => setConfirming(true)} className="w-full sm:w-auto sm:self-start">
          Desconectar
        </Button>
      )}
    </>
  );
}

function Dropped({ status, byOwner, busy, onAction }: Pick<PanelProps, "busy" | "onAction" | "byOwner"> & { status: "disconnected" | "banned_suspected" }) {
  const banned = status === "banned_suspected";
  const button = (
    <Button onClick={() => onAction("reconnect")} disabled={busy !== null} className="w-full sm:w-auto sm:self-start">
      <RefreshCwIcon aria-hidden="true" />
      {busy === "reconnect" ? "Gerando código…" : byOwner ? "Conectar de novo" : "Reconectar"}
    </Button>
  );

  if (byOwner && !banned) {
    return (
      <>
        <p className="max-w-[56ch] text-body text-ink-2">
          As mensagens dos clientes não chegam ao Slotz enquanto o WhatsApp estiver desconectado. Para voltar, gere um
          novo código e leia com o celular.
        </p>
        {button}
      </>
    );
  }
  return (
    <>
      <div role="alert" className="flex items-start gap-3 rounded-control bg-danger/8 px-4 py-3 text-small text-ink">
        <CircleAlertIcon className="mt-0.5 size-[18px] shrink-0 text-danger" aria-hidden="true" />
        <p>
          {banned
            ? "O WhatsApp encerrou a sessão e pode ter restringido o número. Abra o WhatsApp no celular para ver se há aviso de bloqueio antes de reconectar."
            : "As mensagens dos clientes não chegam ao Slotz enquanto a conexão estiver fora. Isso acontece quando o celular fica sem internet ou a sessão é encerrada no aparelho."}
        </p>
      </div>
      <p className="text-small text-ink-2">Para reconectar, gere um novo código e leia com o celular do negócio.</p>
      {button}
    </>
  );
}

function RiskNotice({ className }: { className?: string }) {
  return (
    <aside id="cuidados" aria-labelledby="whatsapp-cuidados" className={cn(PANEL, "scroll-mt-[calc(var(--spacing-header)+5rem)]", className)}>
      <div className="flex items-start gap-3">
        <ShieldAlertIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-ink" />
        <h2 id="whatsapp-cuidados" className="text-title text-ink">
          Risco de bloqueio do número
        </h2>
      </div>
      <p className="mt-4 text-small text-ink-2">
        O Slotz se conecta ao WhatsApp por um caminho não oficial, o mesmo dos aparelhos conectados. O WhatsApp pode
        bloquear números que fogem do uso normal, e a recuperação depende dele, não do Slotz.
      </p>
      <ul className="mt-5 flex flex-col border-t border-line text-small text-ink">
        {[
          "Use o número do negócio, não o seu pessoal.",
          "Não use o número para mensagens em massa ou para contatos que não pediram.",
          "Mantenha o celular com internet e o WhatsApp instalado.",
          "Se a conexão cair, reconecte por aqui lendo um novo código.",
        ].map((item) => (
          <li key={item} className="border-b border-line py-3">
            {item}
          </li>
        ))}
      </ul>
    </aside>
  );
}
