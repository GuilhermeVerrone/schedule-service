"use client";

import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, UserRoundIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageFrame, PageHead } from "@/components/painel/catalog/page-head";
import { EmptyState, ListSkeleton, LoadError } from "@/components/painel/catalog/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchConversations, fetchTimezone, type ConversationSummaryDto } from "./conversations-api";
import { listTime, mergeConversations, previewText } from "./message-format";
import { usePolling } from "./use-polling";

// /painel/conversas (guia 7d; D6, D7): conversas do WhatsApp do tenant, a mais recente primeiro,
// 50 por página, cada linha com contato, última mensagem e horário. Somente leitura. Linhas
// separadas por réguas (DESIGN.md > Services Index); a linha inteira abre a conversa.

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; timezone: string; items: ConversationSummaryDto[]; page: number; hasMore: boolean };

export function ConversationsScreen() {
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const [timezone, conversations] = await Promise.all([fetchTimezone(), fetchConversations(1)]);
    if (!timezone.ok) return setState({ status: "error", message: timezone.message });
    if (!conversations.ok) return setState({ status: "error", message: conversations.message });
    const { items, page, hasMore } = conversations.data.conversations;
    setState({ status: "ready", timezone: timezone.data, items, page, hasMore });
  }, []);

  useEffect(() => {
    // Carga inicial ao montar a tela.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Mensagem nova sobe a conversa para o topo: consulta a 1ª página e junta com o que já está na
  // tela. Falha de fundo não troca a tela pelo erro; a próxima consulta tenta de novo.
  const refresh = useCallback(async () => {
    const result = await fetchConversations(1);
    if (!result.ok) return;
    setState((current) =>
      current.status === "ready"
        ? { ...current, items: mergeConversations(current.items, result.data.conversations.items) }
        : current,
    );
  }, []);
  usePolling(refresh, state.status === "ready");

  async function loadMore() {
    if (state.status !== "ready") return;
    setLoadingMore(true);
    const result = await fetchConversations(state.page + 1);
    setLoadingMore(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const next = result.data.conversations;
    setState((current) =>
      current.status === "ready"
        ? { ...current, items: mergeConversations(current.items, next.items), page: next.page, hasMore: next.hasMore }
        : current,
    );
  }

  return (
    <PageFrame>
      <PageHead
        title="Conversas"
        lead="As mensagens que os clientes mandam para o WhatsApp do negócio. Para responder, use o celular do negócio."
      />
      <div className="mt-head-gap">
        {state.status === "loading" && <ListSkeleton rows={4} label="Carregando conversas…" />}
        {state.status === "error" && <LoadError message={state.message} onRetry={() => void load()} />}
        {state.status === "ready" &&
          (state.items.length === 0 ? (
            <EmptyState
              title="Nenhuma conversa ainda"
              detail="Quando um cliente escrever para o WhatsApp do negócio, a conversa aparece aqui. Confira se o WhatsApp está conectado."
              action={
                <Link href="/painel/whatsapp" className={buttonVariants({ variant: "outline" })}>
                  Ver conexão do WhatsApp
                </Link>
              }
            />
          ) : (
            <>
              <ul aria-label="Conversas" className="border-b border-line">
                {state.items.map((conversation) => (
                  <li key={conversation.id} className="border-t border-line">
                    <ConversationRow conversation={conversation} timezone={state.timezone} />
                  </li>
                ))}
              </ul>
              {state.hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore} className="w-full sm:w-auto">
                    <ChevronDownIcon aria-hidden="true" />
                    {loadingMore ? "Carregando…" : "Mostrar conversas mais antigas"}
                  </Button>
                </div>
              )}
            </>
          ))}
      </div>
    </PageFrame>
  );
}

function ConversationRow({ conversation, timezone }: { conversation: ConversationSummaryDto; timezone: string }) {
  const { contact, lastMessage } = conversation;
  const at = lastMessage?.sentAt ?? conversation.lastMessageAt;
  return (
    <Link
      href={`/painel/conversas/${conversation.id}`}
      className="group -mx-3 flex min-h-[4.5rem] items-center gap-4 rounded-control px-3 py-4 text-ink no-underline outline-none transition-colors duration-160 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint"
    >
      <Initials name={contact.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-label text-ink">{contact.name}</span>
          {at && (
            <time dateTime={at} className="shrink-0 text-micro text-ink-3 tabular-nums">
              {listTime(at, timezone)}
            </time>
          )}
        </span>
        <span className="truncate text-small text-ink-2">{previewText(lastMessage)}</span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="hidden size-[18px] shrink-0 text-ink-3 transition-transform duration-160 ease-brand-out sm:block [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5"
      />
    </Link>
  );
}

// Marcador redondo com as iniciais (DESIGN.md > Shapes: círculos para marcadores). Decorativo.
// Contato sem nome (só o telefone) ganha o ícone de pessoa.
export function Initials({ name, large = false }: { name: string; large?: boolean }) {
  const words = name.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  const initials = words.length === 0 ? null : (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-pill bg-ink/7 font-semibold text-ink",
        large ? "size-14 text-label" : "size-11 text-micro",
      )}
    >
      {initials ?? <UserRoundIcon className={large ? "size-6" : "size-5"} />}
    </span>
  );
}
