"use client";

import { Loader2Icon } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { fieldErrorsOf, focusFirstInvalid } from "@/components/auth/auth-request";
import { Field } from "@/components/auth/field";
import { FormAlert } from "@/components/auth/form-alert";
import { apiRequest } from "@/components/painel/catalog/api-client";
import { PageFrame, PageHead } from "@/components/painel/catalog/page-head";
import { LoadError } from "@/components/painel/catalog/states";
import { useResource } from "@/components/painel/catalog/use-resource";
import { Button } from "@/components/ui/button";
import { AGENDA_LIMITS, agendaSettingsSchema } from "@/server/validation/agenda";
import { formatMinutes, splitMinutes, toMinutes, type DurationUnit } from "./duration";
import { DurationField, TextareaField } from "./fields";

// /painel/configuracoes (guia 3, 7e; D2, D3): dados do negócio que aparecem no site e os cinco
// parâmetros da agenda. Duas seções, cada uma com o próprio formulário e "Salvar": o PATCH é
// parcial, então salvar uma não mexe na outra. Nome, slug e fuso só leitura.

export interface SettingsDto {
  name: string;
  slug: string;
  timezone: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  slotStepMinutes: number;
  bufferMinutes: number;
  minAdvanceMinutes: number;
  maxWindowDays: number;
  cancelDeadlineMinutes: number;
}

type SettingsResponse = { settings: SettingsDto };

// Padrões da D3, para as dicas dos campos.
const DEFAULTS = { slotStepMinutes: 15, bufferMinutes: 0, minAdvanceMinutes: 120, maxWindowDays: 60, cancelDeadlineMinutes: 120 };
const MAX_DAYS = AGENDA_LIMITS.minAdvanceMinutes.max / 1440;

export function SettingsScreen() {
  const { state, reload, setData } = useResource(() => apiRequest<SettingsResponse>("GET", "/api/settings"));
  const saved = (settings: SettingsDto) => setData(() => ({ settings }));

  return (
    <PageFrame>
      <PageHead title="Configurações" lead="Os dados do seu negócio e as regras que definem quais horários ficam livres para agendar." />

      <div className="mt-head-gap">
        {state.status === "loading" && <SettingsSkeleton />}
        {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
        {state.status === "ready" && (
          <div className="border-b border-line">
            <Section
              id="negocio"
              title="Seu negócio"
              detail="Descrição, endereço e telefone aparecem no seu site de agendamento, junto dos serviços e da equipe."
            >
              <BusinessSummary settings={state.data.settings} />
              <BusinessForm settings={state.data.settings} onSaved={saved} />
            </Section>
            <Section
              id="agenda"
              title="Regras da agenda"
              detail="Valem para os horários oferecidos aos clientes. Agendamentos já marcados não mudam."
            >
              <AgendaForm settings={state.data.settings} onSaved={saved} />
            </Section>
          </div>
        )}
      </div>
    </PageFrame>
  );
}

// Seção em duas colunas no desktop (título e explicação à esquerda, formulário à direita),
// empilhada no celular. Réguas de 1px entre seções (DESIGN.md: rules before cards).
function Section({ id, title, detail, children }: { id: string; title: string; detail: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`secao-${id}`} className="grid gap-6 border-t border-line py-[clamp(2rem,1.5rem+2vw,3.5rem)] lg:grid-cols-12 lg:gap-x-6">
      <div className="lg:col-span-4">
        <h2 id={`secao-${id}`} className="text-title text-ink">
          {title}
        </h2>
        <p className="mt-2 max-w-[44ch] text-small text-ink-2">{detail}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-7 lg:col-start-6">{children}</div>
    </section>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-frame bg-surface p-[clamp(1.25rem,1rem+1.2vw,2rem)] ring-1 ring-line">{children}</div>;
}

function BusinessSummary({ settings }: { settings: SettingsDto }) {
  // O endereço do site vem da origem atual (o domínio nunca fica fixo no código).
  const siteAddress = `${window.location.origin}/${settings.slug}`;
  const empty = !settings.description && !settings.address && !settings.phone;
  return (
    <>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[auto_1fr]">
        <SummaryItem term="Nome">{settings.name}</SummaryItem>
        <SummaryItem term="Endereço do site">
          <span className="break-all">{siteAddress}</span>
        </SummaryItem>
        <SummaryItem term="Fuso horário">{settings.timezone.replaceAll("_", " ")}</SummaryItem>
      </dl>
      {empty && (
        <p className="rounded-control bg-tint px-4 py-3 text-small text-ink-2">
          Seu site ainda está sem descrição, endereço e telefone. Preencha abaixo para o cliente saber o que você faz, onde
          atende e como falar com você.
        </p>
      )}
    </>
  );
}

function SummaryItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-small font-semibold text-ink">{term}</dt>
      <dd className="-mt-3 min-w-0 text-small text-ink-2 sm:mt-0">{children}</dd>
    </div>
  );
}

type BusinessField = "description" | "address" | "phone";

function BusinessForm({ settings, onSaved }: { settings: SettingsDto; onSaved: (settings: SettingsDto) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<BusinessField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);

  const clearError = (field: BusinessField) => setErrors((current) => ({ ...current, [field]: undefined }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const input = {
      description: String(data.get("description") ?? ""),
      address: String(data.get("address") ?? ""),
      phone: String(data.get("phone") ?? ""),
    };
    const parsed = agendaSettingsSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrorsOf<BusinessField>(parsed.error));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    setPending(true);
    const result = await apiRequest<SettingsResponse>("PATCH", "/api/settings", input);
    setPending(false);
    if (!result.ok) {
      setAlert(result.message);
      return;
    }
    onSaved(result.data.settings);
    toast.success("Dados do negócio salvos.");
  }

  return (
    <Panel>
      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-label="Dados do negócio" className="flex flex-col gap-6">
        <TextareaField
          name="description"
          label="Descrição"
          defaultValue={settings.description ?? ""}
          maxLength={1000}
          placeholder="Ex.: Salão de bairro com corte, escova e coloração. Atendimento com hora marcada."
          hint="Opcional. Até 1000 caracteres."
          error={errors.description}
          onChange={() => clearError("description")}
        />
        <Field
          name="address"
          label="Endereço"
          autoComplete="street-address"
          defaultValue={settings.address ?? ""}
          maxLength={200}
          placeholder="Ex.: Rua das Flores, 120, Centro, Santos"
          hint="Opcional. Deixe em branco se atende só a domicílio."
          error={errors.address}
          onChange={() => clearError("address")}
        />
        <Field
          name="phone"
          label="Telefone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={settings.phone ?? ""}
          maxLength={30}
          placeholder="Ex.: (13) 99999-0000"
          hint="Opcional. O número que o cliente vê no site."
          error={errors.phone}
          onChange={() => clearError("phone")}
        />
        {alert && <FormAlert message={alert} />}
        <SaveButton pending={pending} />
      </form>
    </Panel>
  );
}

type AgendaField = "slotStepMinutes" | "bufferMinutes" | "minAdvanceMinutes" | "maxWindowDays" | "cancelDeadlineMinutes";

interface AgendaDraft {
  slotStepMinutes: string;
  bufferMinutes: string;
  minAdvance: { amount: string; unit: DurationUnit };
  maxWindowDays: string;
  cancelDeadline: { amount: string; unit: DurationUnit };
}

function draftOf(settings: SettingsDto): AgendaDraft {
  const advance = splitMinutes(settings.minAdvanceMinutes);
  const deadline = splitMinutes(settings.cancelDeadlineMinutes);
  return {
    slotStepMinutes: String(settings.slotStepMinutes),
    bufferMinutes: String(settings.bufferMinutes),
    minAdvance: { amount: String(advance.amount), unit: advance.unit },
    maxWindowDays: String(settings.maxWindowDays),
    cancelDeadline: { amount: String(deadline.amount), unit: deadline.unit },
  };
}

const wholeNumber = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);

// Mensagens no idioma do dono (minutos, horas, dias), antes do schema da API, que fala em minutos.
function validateAgenda(draft: AgendaDraft) {
  const errors: Partial<Record<AgendaField, string>> = {};
  const step = wholeNumber(draft.slotStepMinutes);
  const buffer = wholeNumber(draft.bufferMinutes);
  const advance = toMinutes(draft.minAdvance.amount, draft.minAdvance.unit);
  const windowDays = wholeNumber(draft.maxWindowDays);
  const deadline = toMinutes(draft.cancelDeadline.amount, draft.cancelDeadline.unit);
  const { slotStepMinutes: stepLimit, bufferMinutes: bufferLimit, maxWindowDays: windowLimit } = AGENDA_LIMITS;

  if (step === null || step < stepLimit.min || step > stepLimit.max || step % stepLimit.step !== 0) {
    errors.slotStepMinutes = `Use de ${stepLimit.min} a ${stepLimit.max} minutos, em múltiplos de ${stepLimit.step}.`;
  }
  if (buffer === null || buffer > bufferLimit.max || buffer % bufferLimit.step !== 0) {
    errors.bufferMinutes = `Use de ${bufferLimit.min} a ${bufferLimit.max} minutos, em múltiplos de ${bufferLimit.step}.`;
  }
  if (advance === null) errors.minAdvanceMinutes = "Informe um número, por exemplo 2 horas.";
  else if (advance > AGENDA_LIMITS.minAdvanceMinutes.max) errors.minAdvanceMinutes = `Use no máximo ${MAX_DAYS} dias.`;
  if (windowDays === null || windowDays < windowLimit.min || windowDays > windowLimit.max) {
    errors.maxWindowDays = `Use de ${windowLimit.min} a ${windowLimit.max} dias.`;
  }
  if (deadline === null) errors.cancelDeadlineMinutes = "Informe um número, por exemplo 2 horas.";
  else if (deadline > AGENDA_LIMITS.cancelDeadlineMinutes.max) errors.cancelDeadlineMinutes = `Use no máximo ${MAX_DAYS} dias.`;

  const input = { slotStepMinutes: step, bufferMinutes: buffer, minAdvanceMinutes: advance, maxWindowDays: windowDays, cancelDeadlineMinutes: deadline };
  return { errors, input };
}

function AgendaForm({ settings, onSaved }: { settings: SettingsDto; onSaved: (settings: SettingsDto) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => draftOf(settings));
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<AgendaField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);

  function change<K extends keyof AgendaDraft>(key: K, value: AgendaDraft[K], field: AgendaField) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const { errors: fieldErrors, input } = validateAgenda(draft);
    // O schema da API é a última barreira (mesmas faixas dos CHECKs do banco).
    const parsed = agendaSettingsSchema.safeParse(input);
    const allErrors = { ...(parsed.success ? {} : fieldErrorsOf<AgendaField>(parsed.error)), ...fieldErrors };
    if (Object.values(allErrors).some(Boolean)) {
      setErrors(allErrors);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    setPending(true);
    const result = await apiRequest<SettingsResponse>("PATCH", "/api/settings", input);
    setPending(false);
    if (!result.ok) {
      setAlert(result.message);
      return;
    }
    onSaved(result.data.settings);
    setDraft(draftOf(result.data.settings));
    toast.success("Regras da agenda salvas.");
  }

  return (
    <Panel>
      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-label="Regras da agenda" className="flex flex-col gap-6">
        <div className="grid gap-6 min-[560px]:grid-cols-2">
          <Field
            name="slotStepMinutes"
            label="Intervalo entre horários (minutos)"
            type="number"
            inputMode="numeric"
            min={AGENDA_LIMITS.slotStepMinutes.min}
            max={AGENDA_LIMITS.slotStepMinutes.max}
            step={AGENDA_LIMITS.slotStepMinutes.step}
            value={draft.slotStepMinutes}
            onChange={(event) => change("slotStepMinutes", event.target.value, "slotStepMinutes")}
            hint={`De quanto em quanto tempo os horários aparecem: 9:00, 9:15… Padrão: ${DEFAULTS.slotStepMinutes} minutos.`}
            error={errors.slotStepMinutes}
          />
          <Field
            name="bufferMinutes"
            label="Pausa após cada atendimento (minutos)"
            type="number"
            inputMode="numeric"
            min={AGENDA_LIMITS.bufferMinutes.min}
            max={AGENDA_LIMITS.bufferMinutes.max}
            step={AGENDA_LIMITS.bufferMinutes.step}
            value={draft.bufferMinutes}
            onChange={(event) => change("bufferMinutes", event.target.value, "bufferMinutes")}
            hint="Tempo livre para arrumar o espaço antes do próximo cliente. Padrão: sem pausa."
            error={errors.bufferMinutes}
          />
          <DurationField
            name="minAdvanceMinutes"
            label="Antecedência mínima"
            amount={draft.minAdvance.amount}
            unit={draft.minAdvance.unit}
            onAmountChange={(amount) => change("minAdvance", { ...draft.minAdvance, amount }, "minAdvanceMinutes")}
            onUnitChange={(unit) => change("minAdvance", { ...draft.minAdvance, unit }, "minAdvanceMinutes")}
            hint={`Quanto tempo antes o cliente precisa agendar. Padrão: ${formatMinutes(DEFAULTS.minAdvanceMinutes)}.`}
            error={errors.minAdvanceMinutes}
          />
          <Field
            name="maxWindowDays"
            label="Agenda aberta para os próximos (dias)"
            type="number"
            inputMode="numeric"
            min={AGENDA_LIMITS.maxWindowDays.min}
            max={AGENDA_LIMITS.maxWindowDays.max}
            value={draft.maxWindowDays}
            onChange={(event) => change("maxWindowDays", event.target.value, "maxWindowDays")}
            hint={`Até quantos dias à frente o cliente pode agendar. Padrão: ${DEFAULTS.maxWindowDays} dias.`}
            error={errors.maxWindowDays}
          />
          <DurationField
            name="cancelDeadlineMinutes"
            label="Prazo para cancelar ou remarcar"
            amount={draft.cancelDeadline.amount}
            unit={draft.cancelDeadline.unit}
            onAmountChange={(amount) => change("cancelDeadline", { ...draft.cancelDeadline, amount }, "cancelDeadlineMinutes")}
            onUnitChange={(unit) => change("cancelDeadline", { ...draft.cancelDeadline, unit }, "cancelDeadlineMinutes")}
            hint={`Até quanto tempo antes do horário o cliente pode cancelar ou remarcar pelo link. Padrão: ${formatMinutes(DEFAULTS.cancelDeadlineMinutes)}.`}
            error={errors.cancelDeadlineMinutes}
          />
        </div>
        {alert && <FormAlert message={alert} />}
        <SaveButton pending={pending} />
      </form>
    </Panel>
  );
}

function SaveButton({ pending }: { pending: boolean }) {
  return (
    <div className="flex sm:justify-end">
      <Button type="submit" disabled={pending} aria-disabled={pending} className="w-full sm:w-auto">
        {pending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
        {pending ? "Salvando…" : "Salvar alterações"}
      </Button>
    </div>
  );
}

// Carregando: as duas seções com blocos fantasma no lugar dos campos.
function SettingsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="border-b border-line">
      <span className="sr-only">Carregando configurações…</span>
      {[3, 5].map((fields, index) => (
        <div key={index} aria-hidden="true" className="grid gap-6 border-t border-line py-[clamp(2rem,1.5rem+2vw,3.5rem)] lg:grid-cols-12 lg:gap-x-6">
          <div className="flex flex-col gap-3 lg:col-span-4">
            <span className="h-6 w-40 animate-pulse rounded-sheet bg-tint" />
            <span className="h-4 w-64 max-w-full animate-pulse rounded-sheet bg-tint" />
          </div>
          <div className="flex flex-col gap-5 rounded-frame bg-surface p-[clamp(1.25rem,1rem+1.2vw,2rem)] ring-1 ring-line lg:col-span-7 lg:col-start-6">
            {Array.from({ length: fields }, (_, field) => (
              <div key={field} className="flex flex-col gap-2">
                <span className="h-4 w-32 animate-pulse rounded-sheet bg-tint" />
                <span className="h-input animate-pulse rounded-control bg-tint" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
