"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { fieldErrorsOf, focusFirstInvalid } from "@/components/auth/auth-request";
import { Field } from "@/components/auth/field";
import { FormAlert } from "@/components/auth/form-alert";
import { professionalSchema } from "@/server/validation/catalog";
import { apiRequest, type ProfessionalDto, type ServiceDto } from "./api-client";
import { FormActions, RowPanel } from "./row-panel";
import { ServiceChips } from "./service-chips";

export interface ProfessionalWithServices extends ProfessionalDto {
  services: ServiceDto[];
}

// Criar e editar profissional e escolher os serviços que ele atende (D5, N:N). Grava o nome
// (POST/PATCH) e depois a lista de serviços (PUT, substitui todos). Vínculos com serviços
// arquivados, que não aparecem nos chips, são mantidos.
export function ProfessionalForm({
  professional,
  services,
  onSaved,
  onCancel,
}: {
  professional?: ProfessionalWithServices;
  services: readonly ServiceDto[];
  onSaved: (professional: ProfessionalWithServices, created: boolean) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const initial = new Set(professional?.services.map((service) => service.id) ?? []);
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [pending, setPending] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | null>(null);
  // Se o nome já foi gravado e só os serviços falharam, a próxima tentativa não recria o profissional.
  const [savedBase, setSavedBase] = useState<ProfessionalDto | null>(null);

  function toggle(serviceId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const parsed = professionalSchema.safeParse({ name: new FormData(event.currentTarget).get("name") });
    if (!parsed.success) {
      setNameError(fieldErrorsOf<"name">(parsed.error).name);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setNameError(undefined);
    setPending(true);

    let base: ProfessionalDto | null = savedBase ?? professional ?? null;
    const created = !professional;
    if (!base) {
      const result = await apiRequest<{ professional: ProfessionalDto }>("POST", "/api/professionals", parsed.data);
      if (!result.ok) return fail(result.message);
      base = result.data.professional;
      setSavedBase(base);
    } else if (base.name !== parsed.data.name) {
      const result = await apiRequest<{ professional: ProfessionalDto }>("PATCH", `/api/professionals/${base.id}`, parsed.data);
      if (!result.ok) return fail(result.message);
      base = result.data.professional;
      setSavedBase(base);
    }

    const activeIds = new Set(services.map((service) => service.id));
    const keptArchived = (professional?.services ?? []).filter((service) => !activeIds.has(service.id));
    const serviceIds = [...selected, ...keptArchived.map((service) => service.id)];
    const unchanged = serviceIds.length === initial.size && serviceIds.every((id) => initial.has(id));

    let linked: ServiceDto[] = professional?.services ?? [];
    if (!unchanged) {
      const result = await apiRequest<{ services: ServiceDto[] }>("PUT", `/api/professionals/${base.id}/services`, { serviceIds });
      if (!result.ok) return fail(`O nome foi salvo, mas os serviços não. ${result.message}`);
      linked = result.data.services;
    }

    setPending(false);
    onSaved({ ...base, services: linked }, created);
  }

  // Cancelar depois de o nome já ter sido gravado: a lista recebe o profissional mesmo assim.
  function handleCancel() {
    if (savedBase) onSaved({ ...savedBase, services: professional?.services ?? [] }, !professional);
    else onCancel();
  }

  function fail(message: string) {
    setPending(false);
    setAlert(message);
  }

  const editing = Boolean(professional);

  return (
    <RowPanel>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        aria-label={editing ? `Editar ${professional?.name}` : "Novo profissional"}
        className="flex flex-col gap-6"
      >
        <Field
          name="name"
          label="Nome do profissional"
          autoComplete="off"
          defaultValue={professional?.name}
          placeholder="Ex.: Ana Souza"
          error={nameError}
          onChange={() => setNameError(undefined)}
          autoFocus
        />
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-3 text-small font-semibold text-ink">Serviços que atende</legend>
          {services.length > 0 ? (
            <>
              <ServiceChips services={services} selected={selected} onToggle={toggle} />
              <p className="text-micro text-ink-3">
                {selected.size === 0 ? "Nenhum escolhido. Dá para escolher depois." : `${selected.size} escolhido${selected.size > 1 ? "s" : ""}.`}
              </p>
            </>
          ) : (
            <p className="text-small text-ink-2">
              Você ainda não tem serviços ativos. <Link href="/painel/servicos">Cadastrar serviços</Link>
            </p>
          )}
        </fieldset>
        {alert && <FormAlert message={alert} />}
        <FormActions
          pending={pending}
          submitLabel={editing ? "Salvar alterações" : "Adicionar profissional"}
          pendingLabel="Salvando…"
          onCancel={handleCancel}
        />
      </form>
    </RowPanel>
  );
}
