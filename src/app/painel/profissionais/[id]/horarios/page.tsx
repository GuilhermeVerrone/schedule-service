import type { Metadata } from "next";
import { Suspense } from "react";
import { PageFrame } from "@/components/painel/catalog/page-head";
import { ListSkeleton } from "@/components/painel/catalog/states";
import { WorkingHoursScreen } from "@/components/painel/catalog/working-hours-screen";

export const metadata: Metadata = { title: "Horários · Slotz" };

// O id vem da URL no cliente (useParams), que só existe na requisição: a tela fica atrás de um
// <Suspense> e a casca sai pré-renderizada. Os dados chegam pela API, sempre filtrados pelo tenant.
export default function HorariosPage() {
  return (
    <Suspense
      fallback={
        <PageFrame>
          <h1 className="text-headline text-ink">Horários</h1>
          <div className="mt-head-gap">
            <ListSkeleton rows={7} label="Carregando horários…" />
          </div>
        </PageFrame>
      }
    >
      <WorkingHoursScreen />
    </Suspense>
  );
}
