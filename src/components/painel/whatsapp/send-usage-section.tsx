"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ListSkeleton, LoadError } from "@/components/painel/catalog/states";
import { useResource } from "@/components/painel/catalog/use-resource";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { blockReasonLabel, channelLabel, messageTypeLabel } from "./block-reasons";
import { fetchBlocked, fetchSendUsage, type BlockedMessageDto, type BlockedPageDto, type SendUsageDto } from "./send-usage-api";

// Bloco só leitura de /painel/whatsapp (guia 3, 7f; D6): uso de hoje ("42 de 200"), fase do
// aquecimento (D3, D14) e envios bloqueados com o motivo (D8). Cada painel carrega sozinho, com
// os próprios estados de carregando, vazio e erro. Celular: uma coluna (uso, depois bloqueios).
// Desktop: uso nas colunas 1 a 5 e bloqueios nas 6 a 12. Nada aqui envia nem altera dados.

const PANEL = "rounded-frame border border-line bg-surface p-[clamp(1.25rem,1rem+1.2vw,2rem)]";

export function SendUsageSection() {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-start">
      <UsagePanel className="lg:col-span-5" />
      <BlockedPanel className="lg:col-span-7" />
    </div>
  );
}

function UsagePanel({ className }: { className?: string }) {
  const { state, reload } = useResource(fetchSendUsage);
  return (
    <section aria-labelledby="whatsapp-uso" className={cn(PANEL, className)} data-testid="whatsapp-uso">
      <h2 id="whatsapp-uso" className="text-title text-ink">
        Envios de hoje
      </h2>
      {state.status === "loading" && <UsageSkeleton />}
      {state.status === "error" && (
        <div className="mt-5">
          <LoadError message={state.message} onRetry={() => void reload()} />
        </div>
      )}
      {state.status === "ready" && <Usage usage={state.data} />}
    </section>
  );
}

function UsageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="mt-5 flex flex-col gap-4">
      <span className="sr-only">Carregando o uso de hoje…</span>
      <span aria-hidden="true" className="h-10 w-40 animate-pulse rounded-sheet bg-tint" />
      <span aria-hidden="true" className="h-2 w-full animate-pulse rounded-pill bg-tint" />
      <span aria-hidden="true" className="h-4 w-64 max-w-full animate-pulse rounded-sheet bg-tint" />
      <span aria-hidden="true" className="mt-4 h-5 w-48 animate-pulse rounded-sheet bg-tint" />
      <span aria-hidden="true" className="h-4 w-full animate-pulse rounded-sheet bg-tint" />
    </div>
  );
}

const count = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

function Usage({ usage }: { usage: SendUsageDto }) {
  const { used, limit, manualLimit, warmup } = usage;
  const reached = used >= limit;
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const manualBelowCurve = manualLimit !== null && manualLimit < warmup.curveLimit;

  return (
    <div className="mt-5 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="flex items-baseline gap-2 tabular-nums" data-testid="uso-hoje">
          <span className="font-heading text-headline text-ink">{count(used)}</span>
          <span className="text-lead text-ink-2">de {count(limit)}</span>
          <span className="sr-only">mensagens enviadas hoje</span>
        </p>
        <div
          role="progressbar"
          aria-label="Uso do limite de hoje"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${count(used)} de ${count(limit)}`}
          className="h-2 w-full overflow-hidden rounded-pill bg-tint ring-1 ring-line ring-inset"
        >
          <div className="h-full rounded-pill bg-ink" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-small text-ink-2">
          {reached
            ? "O limite de hoje foi atingido. As próximas mensagens saem amanhã, na ordem em que entraram."
            : "Mensagens automáticas enviadas hoje. O contador volta a zero à meia-noite, no fuso do negócio."}
        </p>
        {manualBelowCurve && (
          <p className="text-small text-ink-2">Limitado pelo teto que você definiu: {count(manualLimit)} por dia.</p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-5" data-testid="aquecimento">
        <h3 className="text-label text-ink">Aquecimento do número</h3>
        {!usage.configured ? (
          <p className="text-small text-ink-2">
            Começa quando o WhatsApp for conectado. Nos primeiros {warmup.totalDays} dias o limite sobe aos poucos, de{" "}
            {count(warmup.curveLimit)} até {count(warmup.matureLimit)} mensagens por dia, para proteger o número.
          </p>
        ) : warmup.inWarmup ? (
          <>
            <p className="text-body text-ink tabular-nums">
              Dia {warmup.day} de {warmup.totalDays}
            </p>
            <WarmupSteps day={warmup.day} totalDays={warmup.totalDays} />
            <p className="text-small text-ink-2">
              Hoje o número pode enviar até {count(warmup.curveLimit)} mensagens.
              {warmup.next && ` A partir do dia ${warmup.next.day}, até ${count(warmup.next.limit)}.`} O limite sobe aos
              poucos para o WhatsApp não estranhar o número novo.
            </p>
          </>
        ) : (
          <p className="text-small text-ink-2">
            Concluído. O número já pode enviar até {count(warmup.matureLimit)} mensagens por dia.
          </p>
        )}
      </div>
    </div>
  );
}

// Um traço por dia do aquecimento; os dias já vividos em grafite.
function WarmupSteps({ day, totalDays }: { day: number; totalDays: number }) {
  return (
    <div aria-hidden="true" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))` }}>
      {Array.from({ length: totalDays }, (_, index) => (
        <span key={index} className={cn("h-1.5 rounded-pill", index < day ? "bg-ink" : "bg-ink/12")} />
      ))}
    </div>
  );
}

function BlockedPanel({ className }: { className?: string }) {
  const { state, reload, setData } = useResource(() => fetchBlocked(1));
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore(current: BlockedPageDto) {
    setLoadingMore(true);
    const result = await fetchBlocked(current.page + 1);
    setLoadingMore(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    // Junta sem repetir: um bloqueio novo pode empurrar itens para a página seguinte.
    setData((data) => {
      const seen = new Set(data.items.map((item) => item.id));
      return { ...result.data, items: [...data.items, ...result.data.items.filter((item) => !seen.has(item.id))] };
    });
  }

  return (
    <section aria-labelledby="whatsapp-bloqueios" className={cn(PANEL, className)} data-testid="whatsapp-bloqueios">
      <h2 id="whatsapp-bloqueios" className="text-title text-ink">
        Envios bloqueados
      </h2>
      <p className="mt-2 max-w-[60ch] text-small text-ink-2">
        Mensagens automáticas que o Slotz não enviou para respeitar as regras de contato, com o motivo.
      </p>
      <div className="mt-5">
        {state.status === "loading" && <ListSkeleton rows={3} label="Carregando os envios bloqueados…" />}
        {state.status === "error" && <LoadError message={state.message} onRetry={() => void reload()} />}
        {state.status === "ready" && state.data.items.length === 0 && (
          <div className="flex flex-col gap-2 border-y border-line py-6">
            <h3 className="text-label text-ink">Nenhum envio bloqueado</h3>
            <p className="max-w-[52ch] text-small text-ink-2">
              Quando uma mensagem não puder sair, porque o cliente pediu para não receber, não tem consentimento ou está
              sem canal, ela aparece aqui com o motivo.
            </p>
          </div>
        )}
        {state.status === "ready" && state.data.items.length > 0 && (
          <>
            <ul className="flex flex-col border-t border-line">
              {state.data.items.map((item) => (
                <BlockedRow key={item.id} item={item} />
              ))}
            </ul>
            {state.data.hasMore && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore(state.data)}
                disabled={loadingMore}
                className="mt-5 w-full sm:w-auto"
              >
                {loadingMore ? "Carregando…" : "Ver mais"}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const dateTimeLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function BlockedRow({ item }: { item: BlockedMessageDto }) {
  const channel = channelLabel(item.channel);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-4" data-reason={item.reason ?? undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-label text-ink">{item.contact.name}</span>
        <time dateTime={item.blockedAt} className="shrink-0 text-micro text-ink-3 tabular-nums">
          {dateTimeLabel(item.blockedAt)}
        </time>
      </div>
      <p className="text-small text-ink">{blockReasonLabel(item.reason)}</p>
      <p className="flex flex-wrap gap-x-2 text-micro text-ink-2">
        <span>{messageTypeLabel(item.messageType)}</span>
        {channel && (
          <>
            <span aria-hidden="true">·</span>
            <span>{channel}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatPhone(item.contact.phone)}</span>
      </p>
    </li>
  );
}
