"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, ChevronUpIcon, InfoIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { toast } from "sonner";
import { PageFrame, PageHead } from "@/components/painel/catalog/page-head";
import { EmptyState, LoadError } from "@/components/painel/catalog/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { Initials } from "./conversations-screen";
import { fetchMessages, fetchTimezone, type ConversationDto, type MessageDto } from "./conversations-api";
import { dayKey, dayLabel, mediaLabel, mergeMessages, timeOf } from "./message-format";
import { usePolling } from "./use-polling";

// /painel/conversas/[id] (guia 7d; D6, D7): as mensagens de uma conversa em ordem cronológica,
// 50 por página (a 1ª página traz as mais recentes; "Mensagens anteriores" busca a próxima).
// Somente leitura: no lugar do campo de resposta, o aviso de que se responde pelo celular.
// Mídia aparece só como "[imagem]", "[áudio]"... Conversa de outro tenant: 404, "não encontrada".

type ScreenState =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | {
      status: "ready";
      timezone: string;
      conversation: ConversationDto;
      messages: MessageDto[];
      // Última página já carregada (mais antiga) e se há outra antes dela.
      page: number;
      hasMore: boolean;
    };

const BACK_LINK =
  "-ml-2 mb-4 inline-flex h-chip items-center gap-2 rounded-control px-2 text-small font-medium text-ink-2 no-underline outline-none transition-colors duration-160 focus-visible:outline-2 focus-visible:outline-violet [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint [@media(hover:hover)_and_(pointer:fine)]:hover:text-ink";

export function ConversationScreen() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const lastRef = useRef<HTMLLIElement>(null);
  // Ao carregar as anteriores, o conteúdo cresce para cima: guarda a distância até o fim da página
  // para a mensagem que estava na tela não sair do lugar.
  const keepFromBottom = useRef<number | null>(null);
  // Na carga e quando chega mensagem nova com o dono no fim da conversa, mostra a última.
  const revealLast = useRef(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const [timezone, result] = await Promise.all([fetchTimezone(), fetchMessages(id, 1)]);
    if (!result.ok) return setState({ status: "error", code: result.code, message: result.message });
    if (!timezone.ok) return setState({ status: "error", code: timezone.code, message: timezone.message });
    const { conversation, messages } = result.data;
    revealLast.current = true;
    setState({
      status: "ready",
      timezone: timezone.data,
      conversation,
      messages: mergeMessages([], messages.items),
      page: messages.page,
      hasMore: messages.hasMore,
    });
  }, [id]);

  useEffect(() => {
    // Carga inicial ao montar a tela.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    const result = await fetchMessages(id, 1);
    if (!result.ok) return;
    const nearEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    setState((current) => {
      if (current.status !== "ready") return current;
      const messages = mergeMessages(current.messages, result.data.messages.items);
      if (messages.length > current.messages.length && nearEnd) revealLast.current = true;
      return {
        ...current,
        conversation: result.data.conversation,
        messages,
        hasMore: current.page === 1 ? result.data.messages.hasMore : current.hasMore,
      };
    });
  }, [id]);
  usePolling(refresh, state.status === "ready");

  async function loadOlder() {
    if (state.status !== "ready") return;
    setLoadingOlder(true);
    const result = await fetchMessages(id, state.page + 1);
    setLoadingOlder(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const older = result.data.messages;
    keepFromBottom.current = document.documentElement.scrollHeight - window.scrollY;
    setState((current) =>
      current.status === "ready"
        ? { ...current, messages: mergeMessages(current.messages, older.items), page: older.page, hasMore: older.hasMore }
        : current,
    );
  }

  const messageCount = state.status === "ready" ? state.messages.length : 0;
  useLayoutEffect(() => {
    if (keepFromBottom.current !== null) {
      window.scrollTo(0, document.documentElement.scrollHeight - keepFromBottom.current);
      keepFromBottom.current = null;
    } else if (revealLast.current) {
      lastRef.current?.scrollIntoView({ block: "nearest" });
      revealLast.current = false;
    }
  }, [messageCount]);

  const backLink = (
    <Link href="/painel/conversas" className={BACK_LINK}>
      <ArrowLeftIcon className="size-[18px]" aria-hidden="true" />
      Conversas
    </Link>
  );

  if (state.status === "error" && state.code === "not_found") {
    return (
      <PageFrame>
        <PageHead before={backLink} title="Conversa não encontrada" lead="Ela pode ter sido removida ou o link está incompleto." />
        <div className="mt-head-gap">
          <EmptyState
            title="Nada para mostrar aqui"
            detail="Volte para a lista e abra a conversa por ela."
            action={
              <Link href="/painel/conversas" className={buttonVariants({ variant: "outline" })}>
                Ver conversas
              </Link>
            }
          />
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      {state.status === "ready" ? (
        <div className="min-w-0">
          {backLink}
          <div className="flex items-center gap-4">
            <Initials name={state.conversation.contact.name} large />
            <div className="min-w-0">
              <h1 className="text-headline break-words text-ink">{state.conversation.contact.name}</h1>
              <p className="mt-1 text-lead text-ink-2 tabular-nums">{formatPhone(state.conversation.contact.phone)}</p>
            </div>
          </div>
        </div>
      ) : (
        <PageHead before={backLink} title="Conversa" lead="As mensagens deste contato no WhatsApp do negócio." />
      )}

      <section aria-label="Mensagens" className="mt-head-gap rounded-frame border border-line bg-surface">
        {state.status === "loading" && <TranscriptSkeleton />}
        {state.status === "error" && (
          <div className="px-[clamp(1rem,0.75rem+1.2vw,2rem)]">
            <LoadError message={state.message} onRetry={() => void load()} />
          </div>
        )}
        {state.status === "ready" && (
          <div className="flex flex-col gap-4 p-[clamp(1rem,0.75rem+1.2vw,2rem)]">
            {state.hasMore && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
                  <ChevronUpIcon aria-hidden="true" />
                  {loadingOlder ? "Carregando…" : "Mensagens anteriores"}
                </Button>
              </div>
            )}
            {state.messages.length === 0 ? (
              <p className="py-8 text-center text-body text-ink-2">Nenhuma mensagem nesta conversa ainda.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {state.messages.map((message, index) => {
                  const previous = state.messages[index - 1];
                  const newDay = !previous || dayKey(previous.sentAt, state.timezone) !== dayKey(message.sentAt, state.timezone);
                  const last = index === state.messages.length - 1;
                  return (
                    <Fragment key={message.id}>
                      {newDay && <DaySeparator label={dayLabel(message.sentAt, state.timezone)} />}
                      <MessageBubble message={message} timezone={state.timezone} ref={last ? lastRef : undefined} />
                    </Fragment>
                  );
                })}
              </ol>
            )}
          </div>
        )}
        <p className="flex items-start gap-3 border-t border-line px-[clamp(1rem,0.75rem+1.2vw,2rem)] py-4 text-small text-ink-2">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-ink-3" />
          Esta tela só mostra as mensagens. Para responder, use o WhatsApp no celular do negócio.
        </p>
      </section>
    </PageFrame>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-3 py-2" aria-label={label}>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span aria-hidden="true" className="text-micro text-ink-3">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </li>
  );
}

// Recebida: à esquerda, em papel com régua. Enviada pelo negócio: à direita, placa grafite
// suave e "Você". O lado e o rótulo distinguem as duas, não só a cor.
function MessageBubble({ message, timezone, ref }: { message: MessageDto; timezone: string; ref?: Ref<HTMLLIElement> }) {
  const outbound = message.direction === "outbound";
  const body = message.body?.trim();
  return (
    <li ref={ref} data-direction={message.direction} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-control px-4 py-2.5 sm:max-w-[min(70%,36rem)]",
          outbound ? "bg-ink/7 text-ink" : "border border-line bg-paper text-ink",
        )}
      >
        <span className="sr-only">{outbound ? "Você" : "Cliente"}:</span>
        <p className="text-body break-words whitespace-pre-wrap">
          {message.mediaType && <span className="font-semibold text-ink-2">{mediaLabel(message.mediaType)}</span>}
          {message.mediaType && body ? " " : null}
          {body}
        </p>
        <span className="flex items-center justify-end gap-1.5 text-micro text-ink-3">
          {outbound && <span>Você ·</span>}
          <time dateTime={message.sentAt} className="tabular-nums">
            {timeOf(message.sentAt, timezone)}
          </time>
        </span>
      </div>
    </li>
  );
}

function TranscriptSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 p-[clamp(1rem,0.75rem+1.2vw,2rem)]">
      <span className="sr-only">Carregando mensagens…</span>
      {["w-56", "w-72 self-end", "w-40", "w-64"].map((width, index) => (
        <span key={index} aria-hidden="true" className={cn("h-14 max-w-[80%] animate-pulse rounded-control bg-tint", width)} />
      ))}
    </div>
  );
}
