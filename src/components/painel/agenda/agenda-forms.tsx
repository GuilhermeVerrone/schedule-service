"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { focusFirstInvalid } from "@/components/auth/auth-request";
import { Field } from "@/components/auth/field";
import { FormAlert } from "@/components/auth/form-alert";
import { formatDuration } from "@/components/painel/catalog/money";
import { FormActions } from "@/components/painel/catalog/row-panel";
import { CONTROL } from "@/components/painel/settings/fields";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/components/painel/catalog/api-client";
import { cn } from "@/lib/utils";
import { normalizePhone } from "@/server/validation/agenda-api";
import {
  conflictMessage,
  isConflict,
  loadSlots,
  type AgendaCatalog,
  type AppointmentDto,
  type SlotDto,
  type TimeBlockDto,
} from "./agenda-data";
import { localDate, localTime, toInstant } from "./agenda-time";

// Formulários da agenda do painel (guia 7d; D4, D9): agendamento manual, remarcar e bloqueio.
// Dia e hora no fuso do negócio; o servidor decide se o horário está livre. Conflito (409, D8)
// vira alerta claro no formulário, marca o campo de horário e recarrega os horários livres.

type Errors<Field extends string> = Partial<Record<Field, string>>;

function SelectField({
  name,
  label,
  error,
  hint,
  children,
  ...props
}: Omit<ComponentProps<"select">, "id" | "name"> & { name: string; label: string; error?: string; hint?: string }) {
  const id = `campo-${name}`;
  const describedBy = error ? `${id}-erro` : hint ? `${id}-dica` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <select
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, "h-input cursor-pointer appearance-none truncate pr-10")}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-ink-2" />
      </div>
      {error ? (
        <p id={`${id}-erro`} className="text-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-dica`} className="text-micro text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function FormTitle({ children, detail }: { children: ReactNode; detail?: string }) {
  return (
    <div>
      <h2 className="text-title text-ink">{children}</h2>
      {detail && <p className="mt-1 text-small text-ink-2">{detail}</p>}
    </div>
  );
}

// Horários livres do dia como atalho para o campo de horário (DESIGN.md > Chips: selecionado em
// violeta). Seguem as regras do site; o dono pode digitar outro horário e o servidor confere.
function SlotChips({
  serviceId,
  professionalId,
  date,
  timezone,
  value,
  refreshKey,
  onPick,
}: {
  serviceId: string;
  professionalId: string;
  date: string;
  timezone: string;
  value: string;
  refreshKey: number;
  onPick: (time: string) => void;
}) {
  const [state, setState] = useState<{ key: string; slots: SlotDto[] | null; failed: boolean }>({ key: "", slots: null, failed: false });
  const key = `${serviceId}|${professionalId}|${date}|${refreshKey}`;
  const ready = Boolean(serviceId && professionalId && /^\d{4}-\d{2}-\d{2}$/.test(date));

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void loadSlots(serviceId, professionalId, date).then((result) => {
      if (active) setState({ key, slots: result.ok ? result.data : null, failed: !result.ok });
    });
    return () => {
      active = false;
    };
  }, [key, ready, serviceId, professionalId, date]);

  if (!ready) return null;
  const loading = state.key !== key;
  const times = state.slots?.map((slot) => localTime(slot.startsAt, timezone)) ?? [];

  return (
    <div className="flex flex-col gap-2" aria-busy={loading}>
      <p className="text-small font-semibold text-ink" id="horarios-livres">
        Horários livres
      </p>
      {loading ? (
        <p role="status" className="text-small text-ink-3">
          Carregando horários livres…
        </p>
      ) : state.failed ? (
        <p className="text-small text-ink-3">Não foi possível carregar os horários livres. Digite o horário acima.</p>
      ) : times.length === 0 ? (
        <p className="text-small text-ink-3">Nenhum horário livre nesse dia pelas regras do site. Você ainda pode digitar um horário.</p>
      ) : (
        <ul aria-labelledby="horarios-livres" className="flex flex-wrap gap-2">
          {times.map((time) => {
            const selected = time === value;
            return (
              <li key={time}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(time)}
                  className={cn(
                    "flex h-chip cursor-pointer items-center gap-1.5 rounded-pill border px-3.5 text-small font-medium tabular-nums transition-[background-color,border-color,color,transform] duration-160 ease-brand-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet active:scale-97",
                    selected
                      ? "border-violet bg-violet text-on-dark [@media(hover:hover)_and_(pointer:fine)]:hover:bg-violet-deep"
                      : "border-line-strong bg-surface text-ink [@media(hover:hover)_and_(pointer:fine)]:hover:border-ink",
                  )}
                >
                  {selected && <CheckIcon aria-hidden="true" strokeWidth={2.5} className="size-[15px]" />}
                  {time}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-micro text-ink-3">
        Os horários livres seguem as regras do site, como a antecedência mínima. Você pode digitar outro horário no campo acima.
      </p>
    </div>
  );
}

// ---------- Novo agendamento ----------

type AppointmentField = "serviceId" | "professionalId" | "date" | "time" | "name" | "phone" | "email";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function professionalsFor(catalog: AgendaCatalog, serviceId: string) {
  return catalog.professionals.filter((professional) => catalog.servicesByProfessional[professional.id]?.includes(serviceId));
}

export function AppointmentForm({
  catalog,
  defaultDate,
  defaultProfessionalId,
  onSaved,
  onCancel,
}: {
  catalog: AgendaCatalog;
  defaultDate: string;
  defaultProfessionalId: string | null;
  onSaved: (appointment: AppointmentDto) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bookable = catalog.services.filter((service) => professionalsFor(catalog, service.id).length > 0);
  const firstService =
    bookable.find((service) => defaultProfessionalId && catalog.servicesByProfessional[defaultProfessionalId]?.includes(service.id)) ?? bookable[0];
  const [serviceId, setServiceId] = useState(firstService?.id ?? "");
  const options = professionalsFor(catalog, serviceId);
  const [professionalId, setProfessionalId] = useState(
    options.find((professional) => professional.id === defaultProfessionalId)?.id ?? options[0]?.id ?? "",
  );
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors<AppointmentField>>({});
  const [alert, setAlert] = useState<string | null>(null);

  const clear = (field: AppointmentField) => setErrors((current) => ({ ...current, [field]: undefined }));
  const service = catalog.services.find((item) => item.id === serviceId);
  const professional = catalog.professionals.find((item) => item.id === professionalId);

  function changeService(next: string) {
    setServiceId(next);
    clear("serviceId");
    const nextOptions = professionalsFor(catalog, next);
    if (!nextOptions.some((item) => item.id === professionalId)) setProfessionalId(nextOptions[0]?.id ?? "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const phone = normalizePhone(String(data.get("phone") ?? ""));
    const email = String(data.get("email") ?? "").trim();
    const startsAt = toInstant(date, time, catalog.timezone);

    const found: Errors<AppointmentField> = {};
    if (!serviceId) found.serviceId = "Escolha o serviço.";
    if (!professionalId) found.professionalId = "Escolha o profissional.";
    if (!date) found.date = "Informe o dia.";
    if (!time) found.time = "Informe o horário ou escolha um dos horários livres.";
    else if (date && !startsAt) found.time = "Esse horário não existe nesse dia. Escolha outro.";
    if (name.length < 2) found.name = "Informe o nome do cliente.";
    else if (name.length > 80) found.name = "O nome pode ter no máximo 80 caracteres.";
    if (!/^55\d{10,11}$/.test(phone)) found.phone = "Informe o telefone com DDD, por exemplo (11) 98765-4321.";
    if (email && !EMAIL.test(email)) found.email = "Confira o e-mail, por exemplo nome@exemplo.com.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    setErrors({});
    setPending(true);
    const result = await apiRequest<{ appointment: AppointmentDto }>("POST", "/api/appointments", {
      serviceId,
      professionalId,
      startsAt,
      customer: { name, phone, email: email || null },
    });
    setPending(false);
    if (result.ok) {
      onSaved(result.data.appointment);
      return;
    }
    setAlert(conflictMessage(result.code, result.message, professional?.name));
    if (isConflict(result.code)) {
      setErrors({ time: "Escolha outro horário." });
      setRefreshKey((key) => key + 1);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-label="Novo agendamento" className="flex flex-col gap-6">
      <FormTitle detail="Para quem marcou por telefone, WhatsApp ou no balcão.">Novo agendamento</FormTitle>
      <div className="grid gap-6 min-[560px]:grid-cols-2">
        <SelectField
          name="serviceId"
          label="Serviço"
          value={serviceId}
          onChange={(event) => changeService(event.target.value)}
          error={errors.serviceId}
          hint={service ? `Duração: ${formatDuration(service.durationMinutes)}.` : undefined}
          autoFocus
        >
          {bookable.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="professionalId"
          label="Profissional"
          value={professionalId}
          onChange={(event) => {
            setProfessionalId(event.target.value);
            clear("professionalId");
          }}
          error={errors.professionalId}
          hint="Só quem atende esse serviço."
        >
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <Field
          name="date"
          label="Dia"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            clear("date");
          }}
          error={errors.date}
        />
        <Field
          name="time"
          label="Horário"
          type="time"
          step={catalog.slotStepMinutes * 60}
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
            clear("time");
          }}
          error={errors.time}
        />
      </div>
      <SlotChips
        serviceId={serviceId}
        professionalId={professionalId}
        date={date}
        timezone={catalog.timezone}
        value={time}
        refreshKey={refreshKey}
        onPick={(picked) => {
          setTime(picked);
          clear("time");
        }}
      />
      <div className="grid gap-6 border-t border-line pt-6 min-[560px]:grid-cols-2">
        <div className="min-[560px]:col-span-2">
          <Field
            name="name"
            label="Nome do cliente"
            autoComplete="off"
            maxLength={80}
            error={errors.name}
            onChange={() => clear("name")}
          />
        </div>
        <Field
          name="phone"
          label="Telefone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="(11) 98765-4321"
          hint="Com DDD. Se o cliente já existe, o cadastro é reaproveitado."
          error={errors.phone}
          onChange={() => clear("phone")}
        />
        <Field
          name="email"
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="off"
          hint="Opcional."
          error={errors.email}
          onChange={() => clear("email")}
        />
      </div>
      {alert && <FormAlert message={alert} />}
      <FormActions pending={pending} submitLabel="Agendar" pendingLabel="Agendando…" onCancel={onCancel} />
    </form>
  );
}

// ---------- Remarcar ----------

type RescheduleField = "date" | "time";

export function RescheduleForm({
  appointment,
  catalog,
  onSaved,
  onCancel,
}: {
  appointment: AppointmentDto;
  catalog: AgendaCatalog;
  onSaved: (appointment: AppointmentDto) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState(() => localDate(appointment.startsAt, catalog.timezone));
  const [time, setTime] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors<RescheduleField>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const clear = (field: RescheduleField) => setErrors((current) => ({ ...current, [field]: undefined }));
  const minutes = Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const startsAt = toInstant(date, time, catalog.timezone);
    const found: Errors<RescheduleField> = {};
    if (!date) found.date = "Informe o novo dia.";
    if (!time) found.time = "Informe o novo horário ou escolha um dos horários livres.";
    else if (date && !startsAt) found.time = "Esse horário não existe nesse dia. Escolha outro.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    setPending(true);
    const result = await apiRequest<{ appointment: AppointmentDto }>("POST", `/api/appointments/${appointment.id}/reschedule`, { startsAt });
    setPending(false);
    if (result.ok) {
      onSaved(result.data.appointment);
      return;
    }
    setAlert(conflictMessage(result.code, result.message, appointment.professional.name));
    if (isConflict(result.code)) {
      setErrors({ time: "Escolha outro horário." });
      setRefreshKey((key) => key + 1);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      aria-label={`Remarcar ${appointment.customer.name}`}
      className="flex flex-col gap-6"
    >
      <FormTitle detail={`Mesmo profissional e mesma duração (${formatDuration(minutes)}). O horário atual fica livre.`}>Remarcar</FormTitle>
      <div className="grid gap-6 min-[560px]:grid-cols-2">
        <Field
          name="date"
          label="Novo dia"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            clear("date");
          }}
          error={errors.date}
          autoFocus
        />
        <Field
          name="time"
          label="Novo horário"
          type="time"
          step={catalog.slotStepMinutes * 60}
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
            clear("time");
          }}
          error={errors.time}
        />
      </div>
      <SlotChips
        serviceId={appointment.service.id}
        professionalId={appointment.professional.id}
        date={date}
        timezone={catalog.timezone}
        value={time}
        refreshKey={refreshKey}
        onPick={(picked) => {
          setTime(picked);
          clear("time");
        }}
      />
      {alert && <FormAlert message={alert} />}
      <FormActions pending={pending} submitLabel="Remarcar" pendingLabel="Remarcando…" onCancel={onCancel} />
    </form>
  );
}

// ---------- Bloqueio ----------

type BlockField = "professionalId" | "date" | "start" | "end" | "reason";

export function BlockForm({
  catalog,
  defaultDate,
  defaultProfessionalId,
  onSaved,
  onCancel,
}: {
  catalog: AgendaCatalog;
  defaultDate: string;
  defaultProfessionalId: string | null;
  onSaved: (block: TimeBlockDto) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors<BlockField>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const clear = (field: BlockField) => setErrors((current) => ({ ...current, [field]: undefined }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const professionalId = String(data.get("professionalId") ?? "");
    const date = String(data.get("date") ?? "");
    const start = String(data.get("start") ?? "");
    const end = String(data.get("end") ?? "");
    const reason = String(data.get("reason") ?? "").trim();
    const startsAt = toInstant(date, start, catalog.timezone);
    const endsAt = toInstant(date, end, catalog.timezone);

    const found: Errors<BlockField> = {};
    if (!professionalId) found.professionalId = "Escolha o profissional.";
    if (!date) found.date = "Informe o dia.";
    if (!start) found.start = "Informe o início.";
    else if (date && !startsAt) found.start = "Esse horário não existe nesse dia.";
    if (!end) found.end = "Informe o fim.";
    else if (date && !endsAt) found.end = "Esse horário não existe nesse dia.";
    else if (startsAt && endsAt && endsAt <= startsAt) found.end = "O fim deve ser depois do início.";
    if (reason.length > 200) found.reason = "O motivo pode ter no máximo 200 caracteres.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    setErrors({});
    setPending(true);
    const result = await apiRequest<{ timeBlock: TimeBlockDto }>("POST", "/api/time-blocks", {
      professionalId,
      startsAt,
      endsAt,
      reason: reason || null,
    });
    setPending(false);
    if (result.ok) onSaved(result.data.timeBlock);
    else setAlert(result.message);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-label="Bloquear horário" className="flex flex-col gap-6">
      <FormTitle detail="Folga, consulta médica ou qualquer horário em que ninguém pode agendar com esse profissional.">
        Bloquear horário
      </FormTitle>
      <div className="grid gap-6 min-[560px]:grid-cols-2">
        <SelectField
          name="professionalId"
          label="Profissional"
          defaultValue={defaultProfessionalId ?? catalog.professionals[0]?.id}
          error={errors.professionalId}
          onChange={() => clear("professionalId")}
          autoFocus
        >
          {catalog.professionals.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <Field name="date" label="Dia" type="date" defaultValue={defaultDate} error={errors.date} onChange={() => clear("date")} />
        <Field name="start" label="Início" type="time" defaultValue="12:00" error={errors.start} onChange={() => clear("start")} />
        <Field name="end" label="Fim" type="time" defaultValue="13:00" error={errors.end} onChange={() => clear("end")} />
        <div className="min-[560px]:col-span-2">
          <Field
            name="reason"
            label="Motivo"
            maxLength={200}
            placeholder="Ex.: almoço, dentista, curso"
            hint="Opcional. Só você vê."
            error={errors.reason}
            onChange={() => clear("reason")}
          />
        </div>
      </div>
      <p className="text-micro text-ink-3">Agendamentos que já existem nesse horário continuam marcados.</p>
      {alert && <FormAlert message={alert} />}
      <FormActions pending={pending} submitLabel="Bloquear" pendingLabel="Bloqueando…" onCancel={onCancel} />
    </form>
  );
}
