"use client";

import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiRequest, type ServiceDto } from "./api-client";
import { ArchivedSection } from "./archived-section";
import { formatCents, formatDuration } from "./money";
import { PageFrame, PageHead } from "./page-head";
import { ServiceForm } from "./service-form";
import { EmptyState, ListSkeleton, LoadError } from "./states";
import { useResource } from "./use-resource";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

// /painel/servicos (guia 7c): lista em linhas separadas por réguas, criar e editar no lugar,
// arquivar com "Desfazer" no toast e restaurar na lista de arquivados (D6).
export function ServicesScreen() {
  const { state, reload, setData } = useResource(() =>
    apiRequest<{ services: ServiceDto[] }>("GET", "/api/services?includeArchived=true"),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function upsert(service: ServiceDto) {
    setData(({ services }) => ({
      services: [...services.filter((item) => item.id !== service.id), service].sort(byName),
    }));
  }

  async function setArchived(service: ServiceDto, archived: boolean, undo = true) {
    setBusy(service.id);
    const result = await apiRequest<{ service: ServiceDto }>(
      "POST",
      `/api/services/${service.id}/${archived ? "archive" : "unarchive"}`,
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    upsert(result.data.service);
    if (open === service.id) setOpen(null);
    toast.success(archived ? `${service.name} foi arquivado.` : `${service.name} voltou para a lista.`, {
      action: undo ? { label: "Desfazer", onClick: () => void setArchived(result.data.service, !archived, false) } : undefined,
    });
  }

  const newButton = (
    <Button onClick={() => setOpen("new")} disabled={open === "new"} className="w-full sm:w-auto">
      <PlusIcon aria-hidden="true" />
      Novo serviço
    </Button>
  );

  const services = state.status === "ready" ? state.data.services : [];
  const active = services.filter((service) => !service.archivedAt);
  const archived = services.filter((service) => service.archivedAt);

  return (
    <PageFrame>
      <PageHead
        title="Serviços"
        lead="O que você atende, quanto tempo leva e quanto custa."
        action={state.status === "ready" && active.length > 0 && open !== "new" ? newButton : undefined}
      />

      <div className="mt-head-gap">
        {state.status === "loading" && <ListSkeleton label="Carregando serviços…" />}
        {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
        {state.status === "ready" && (
          <>
            {open === "new" && (
              <div className="pb-6">
                <ServiceForm
                  onCancel={() => setOpen(null)}
                  onSaved={(service) => {
                    upsert(service);
                    setOpen(null);
                    toast.success(`${service.name} foi adicionado.`);
                  }}
                />
              </div>
            )}

            {active.length === 0 && open !== "new" ? (
              <EmptyState
                title="Nenhum serviço ainda"
                detail="Cadastre o primeiro atendimento com duração e preço. Depois você escolhe quais profissionais fazem cada um."
                action={newButton}
              />
            ) : (
              active.length > 0 && (
                <ul aria-label="Serviços ativos" className="border-b border-line">
                  {active.map((service) => (
                    <li key={service.id} className="border-t border-line">
                      {open === service.id ? (
                        <div className="py-4">
                          <ServiceForm
                            service={service}
                            onCancel={() => setOpen(null)}
                            onSaved={(saved) => {
                              upsert(saved);
                              setOpen(null);
                              toast.success("Alterações salvas.");
                            }}
                          />
                        </div>
                      ) : (
                        <ServiceRow service={service}>
                          <Button variant="outline" size="sm" onClick={() => setOpen(service.id)} aria-label={`Editar ${service.name}`}>
                            <PencilIcon aria-hidden="true" />
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void setArchived(service, true)}
                            disabled={busy === service.id}
                            aria-label={`Arquivar ${service.name}`}
                          >
                            <ArchiveIcon aria-hidden="true" />
                            Arquivar
                          </Button>
                        </ServiceRow>
                      )}
                    </li>
                  ))}
                </ul>
              )
            )}

            {archived.length > 0 && (
              <ArchivedSection count={archived.length} open={showArchived} onToggle={() => setShowArchived((value) => !value)} noun="serviços">
                {archived.map((service) => (
                  <li key={service.id} className="border-t border-line">
                    <ServiceRow service={service} muted>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void setArchived(service, false)}
                        disabled={busy === service.id}
                        aria-label={`Restaurar ${service.name}`}
                      >
                        <ArchiveRestoreIcon aria-hidden="true" />
                        Restaurar
                      </Button>
                    </ServiceRow>
                  </li>
                ))}
              </ArchivedSection>
            )}
          </>
        )}
      </div>
    </PageFrame>
  );
}

function ServiceRow({ service, muted = false, children }: { service: ServiceDto; muted?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <h3 className={cn("text-title break-words", muted ? "text-ink-2" : "text-ink")}>{service.name}</h3>
        <p className="mt-1 text-small text-ink-2">
          {formatDuration(service.durationMinutes)} <span aria-hidden="true">·</span>
          <span className="sr-only">,</span> {formatCents(service.priceCents)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
