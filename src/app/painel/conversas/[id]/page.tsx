import type { Metadata } from "next";
import { Suspense } from "react";
import { PageFrame } from "@/components/painel/catalog/page-head";
import { ListSkeleton } from "@/components/painel/catalog/states";
import { ConversationScreen } from "@/components/painel/conversas/conversation-screen";

export const metadata: Metadata = { title: "Conversa · Slotz" };

// O id vem da URL no cliente (useParams), que só existe na requisição: a tela fica atrás de um
// <Suspense> e a casca sai pré-renderizada. As mensagens chegam pela API, filtradas pelo tenant.
export default function ConversaPage() {
  return (
    <Suspense
      fallback={
        <PageFrame>
          <h1 className="text-headline text-ink">Conversa</h1>
          <div className="mt-head-gap">
            <ListSkeleton rows={4} label="Carregando mensagens…" />
          </div>
        </PageFrame>
      }
    >
      <ConversationScreen />
    </Suspense>
  );
}
