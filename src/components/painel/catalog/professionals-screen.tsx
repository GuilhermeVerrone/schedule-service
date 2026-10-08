"use client";

import Link from "next/link";
import { ArchiveIcon, ArchiveRestoreIcon, ClockIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiRequest, type ApiResult, type ProfessionalDto, type ServiceDto } from "./api-client";
import { ArchivedSection } from "./archived-section";
import { PageFrame, PageHead } from "./page-head";
import { ProfessionalForm, type ProfessionalWithServices } from "./professional-form";
import { EmptyState, ListSkeleton, LoadError } from "./states";
import { useResource } from "./use-resource";

interface ScreenData {
  professionals: ProfessionalWithServices[];
  services: ServiceDto[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

// Profissionais (com arquivados), serviços ativos para os chips e os serviços de cada
// profissional ativo. Sem paginação nesta fatia (premissa h).
async function loadScreen(): Promise<ApiResult<ScreenData>> {
  const [professionals, services] = await Promise.all([
    apiRequest<{ professionals: ProfessionalDto[] }>("GET", "/api/professionals?includeArchived=true"),
    apiRequest<{ services: ServiceDto[] }>("GET", "/api/services"),
  ]);
  if (!professionals.ok) return professionals;
  if (!services.ok) return services;

  const linked = await Promise.all(
    professionals.data.professionals.map((professional) =>
      professional.archivedAt
        ? Promise.resolve<ApiResult<{ services: ServiceDto[] }>>({ ok: true, data: { services: [] } })
        : apiRequest<{ services: ServiceDto[] }>("GET", `/api/professionals/${professional.id}/services`),
    ),
  );
  const failed = linked.find((result) => !result.ok);
  if (failed && !failed.ok) return failed;

  return {
    ok: true,
    data: {
      services: services.data.services,
      professionals: professionals.data.professionals.map((professional, index) => ({
        ...professional,
        services: linked[index].ok ? linked[index].data.services : [],
      })),
    },
  };
}

// /painel/profissionais (guia 7c): quem atende e quais serviços cada um faz; criar, editar e
// vincular no lugar; arquivar com "Desfazer"; atalho para os horários de cada profissional.
export function ProfessionalsScreen() {
  const { state, reload, setData } = useResource(loadScreen);
  const [open, setOpen] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function upsert(professional: ProfessionalWithServices) {
    setData((data) => ({
      ...data,
      professionals: [...data.professionals.filter((item) => item.id !== professional.id), professional].sort(byName),
    }));
  }

  async function setArchived(professional: ProfessionalWithServices, archived: boolean, undo = true) {
    setBusy(professional.id);
    const result = await apiRequest<{ professional: ProfessionalDto }>(
      "POST",
      `/api/professionals/${professional.id}/${archived ? "archive" : "unarchive"}`,
    );
    if (!result.ok) {
      setBusy(null);
      toast.error(result.message);
      return;
    }
    // Ao restaurar, busca de novo os serviços vinculados (arquivado não carrega a lista).
    let services = professional.services;
    if (!archived) {
      const linked = await apiRequest<{ services: ServiceDto[] }>("GET", `/api/professionals/${professional.id}/services`);
      if (linked.ok) services = linked.data.services;
    }
    setBusy(null);
    const updated = { ...result.data.professional, services };
    upsert(updated);
    if (open === professional.id) setOpen(null);
    toast.success(archived ? `${professional.name} foi arquivado.` : `${professional.name} voltou para a equipe.`, {
      action: undo ? { label: "Desfazer", onClick: () => void setArchived(updated, !archived, false) } : undefined,
    });
  }

  const newButton = (
    <Button onClick={() => setOpen("new")} disabled={open === "new"} className="w-full sm:w-auto">
      <PlusIcon aria-hidden="true" />
      Novo profissional
    </Button>
  );

  const data = state.status === "ready" ? state.data : { professionals: [], services: [] };
  const active = data.professionals.filter((professional) => !professional.archivedAt);
  const archived = data.professionals.filter((professional) => professional.archivedAt);
  const activeServiceIds = new Set(data.services.map((service) => service.id));

  function onSaved(professional: ProfessionalWithServices, created: boolean) {
    upsert(professional);
    setOpen(null);
    toast.success(created ? `${professional.name} entrou na equipe.` : "Alterações salvas.");
  }

  return (
    <PageFrame>
      <PageHead
        title="Profissionais"
        lead="Quem atende no seu negócio, quais serviços cada pessoa faz e em que horários."
        action={state.status === "ready" && active.length > 0 && open !== "new" ? newButton : undefined}
      />

      <div className="mt-head-gap">
        {state.status === "loading" && <ListSkeleton label="Carregando profissionais…" />}
        {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
        {state.status === "ready" && (
          <>
            {open === "new" && (
              <div className="pb-6">
                <ProfessionalForm services={data.services} onCancel={() => setOpen(null)} onSaved={onSaved} />
              </div>
            )}

            {active.length === 0 && open !== "new" ? (
              <EmptyState
                title="Nenhum profissional ainda"
                detail="Cadastre quem atende, mesmo que seja só você. Depois escolha os serviços e os horários de cada pessoa."
                action={newButton}
              />
            ) : (
              active.length > 0 && (
                <ul aria-label="Equipe" className="border-b border-line">
                  {active.map((professional) => (
                    <li key={professional.id} className="border-t border-line">
                      {open === professional.id ? (
                        <div className="py-4">
                          <ProfessionalForm
                            professional={professional}
                            services={data.services}
                            onCancel={() => setOpen(null)}
                            onSaved={onSaved}
                          />
                        </div>
                      ) : (
                        <ProfessionalRow
                          name={professional.name}
                          detail={servicesLine(professional.services.filter((service) => activeServiceIds.has(service.id)))}
                        >
                          <Link
                            href={`/painel/profissionais/${professional.id}/horarios`}
                            aria-label={`Horários de ${professional.name}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            <ClockIcon aria-hidden="true" />
                            Horários
                          </Link>
                          <Button variant="outline" size="sm" onClick={() => setOpen(professional.id)} aria-label={`Editar ${professional.name}`}>
                            <PencilIcon aria-hidden="true" />
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void setArchived(professional, true)}
                            disabled={busy === professional.id}
                            aria-label={`Arquivar ${professional.name}`}
                          >
                            <ArchiveIcon aria-hidden="true" />
                            Arquivar
                          </Button>
                        </ProfessionalRow>
                      )}
                    </li>
                  ))}
                </ul>
              )
            )}

            {archived.length > 0 && (
              <ArchivedSection count={archived.length} open={showArchived} onToggle={() => setShowArchived((value) => !value)} noun="profissionais">
                {archived.map((professional) => (
                  <li key={professional.id} className="border-t border-line">
                    <ProfessionalRow name={professional.name} detail="Arquivado. Não aparece para agendamento." muted>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void setArchived(professional, false)}
                        disabled={busy === professional.id}
                        aria-label={`Restaurar ${professional.name}`}
                      >
                        <ArchiveRestoreIcon aria-hidden="true" />
                        Restaurar
                      </Button>
                    </ProfessionalRow>
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

function servicesLine(services: readonly ServiceDto[]): string {
  if (services.length === 0) return "Nenhum serviço escolhido";
  return services.map((service) => service.name).join(", ");
}

function ProfessionalRow({ name, detail, muted = false, children }: { name: string; detail: string; muted?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 lg:flex-row lg:items-center lg:gap-6">
      <div className="min-w-0 flex-1">
        <h3 className={cn("text-title break-words", muted ? "text-ink-2" : "text-ink")}>{name}</h3>
        <p className="mt-1 text-small break-words text-ink-2">{detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
