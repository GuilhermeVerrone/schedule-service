"use client";

import { useRef, useState, type FormEvent } from "react";
import { fieldErrorsOf, focusFirstInvalid } from "@/components/auth/auth-request";
import { Field } from "@/components/auth/field";
import { FormAlert } from "@/components/auth/form-alert";
import { DURATION_MAX_MINUTES, DURATION_MIN_MINUTES, DURATION_STEP_MINUTES, serviceSchema } from "@/server/validation/catalog";
import { apiRequest, type ServiceDto } from "./api-client";
import { centsToInput, parseBrlToCents } from "./money";
import { FormActions, RowPanel } from "./row-panel";

type ServiceField = "name" | "durationMinutes" | "priceCents";

// Criar e editar serviço (D5): nome, duração em múltiplos de 5 min (5 a 480) e preço digitado em
// reais, gravado em centavos inteiros. Validação com o mesmo schema Zod da API antes de enviar;
// erro do servidor aparece no alerta do formulário.
export function ServiceForm({
  service,
  onSaved,
  onCancel,
}: {
  service?: ServiceDto;
  onSaved: (service: ServiceDto) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ServiceField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const editing = Boolean(service);

  function clearError(field: ServiceField) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const rawDuration = String(data.get("durationMinutes") ?? "").trim();
    const priceCents = parseBrlToCents(String(data.get("priceCents") ?? ""));

    const parsed = serviceSchema.safeParse({
      name: data.get("name"),
      durationMinutes: rawDuration === "" ? undefined : Number(rawDuration),
      priceCents: priceCents ?? undefined,
    });
    const fieldErrors = parsed.success ? {} : fieldErrorsOf<ServiceField>(parsed.error);
    if (rawDuration === "") fieldErrors.durationMinutes = "Informe a duração em minutos.";
    if (priceCents === null) fieldErrors.priceCents = "Informe o preço em reais, por exemplo 50,00.";
    if (!parsed.success || Object.values(fieldErrors).some(Boolean)) {
      setErrors(fieldErrors);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    setErrors({});
    setPending(true);
    const result = service
      ? await apiRequest<{ service: ServiceDto }>("PATCH", `/api/services/${service.id}`, parsed.data)
      : await apiRequest<{ service: ServiceDto }>("POST", "/api/services", parsed.data);
    setPending(false);
    if (result.ok) onSaved(result.data.service);
    else setAlert(result.message);
  }

  return (
    <RowPanel>
      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-label={editing ? `Editar ${service?.name}` : "Novo serviço"} className="flex flex-col gap-6">
        <Field
          name="name"
          label="Nome do serviço"
          autoComplete="off"
          defaultValue={service?.name}
          placeholder="Ex.: Corte feminino"
          error={errors.name}
          onChange={() => clearError("name")}
          autoFocus
        />
        <div className="grid gap-6 min-[560px]:grid-cols-2">
          <Field
            name="durationMinutes"
            label="Duração (minutos)"
            type="number"
            inputMode="numeric"
            min={DURATION_MIN_MINUTES}
            max={DURATION_MAX_MINUTES}
            step={DURATION_STEP_MINUTES}
            defaultValue={service?.durationMinutes}
            placeholder="Ex.: 45"
            hint={`Múltiplos de ${DURATION_STEP_MINUTES}, de ${DURATION_MIN_MINUTES} a ${DURATION_MAX_MINUTES} minutos.`}
            error={errors.durationMinutes}
            onChange={() => clearError("durationMinutes")}
          />
          <Field
            name="priceCents"
            label="Preço (R$)"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={service ? centsToInput(service.priceCents) : undefined}
            placeholder="Ex.: 50,00"
            hint="Use 0 para serviço sem cobrança."
            error={errors.priceCents}
            onChange={() => clearError("priceCents")}
          />
        </div>
        {alert && <FormAlert message={alert} />}
        <FormActions
          pending={pending}
          submitLabel={editing ? "Salvar alterações" : "Adicionar serviço"}
          pendingLabel="Salvando…"
          onCancel={onCancel}
        />
      </form>
    </RowPanel>
  );
}
