"use client";

import Link from "next/link";
import { CalendarPlusIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, LockIcon } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { apiRequest } from "@/components/painel/catalog/api-client";
import { formatCents, formatDuration } from "@/components/painel/catalog/money";
import { PageFrame, PageHead } from "@/components/painel/catalog/page-head";
import { RowPanel } from "@/components/painel/catalog/row-panel";
import { ListSkeleton, LoadError } from "@/components/painel/catalog/states";
import { useResource } from "@/components/painel/catalog/use-resource";
import { CONTROL } from "@/components/painel/settings/fields";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  loadCatalog,
  loadRange,
  STATUS_LABEL,
  type AgendaCatalog,
  type AgendaRange,
  type AppointmentDto,
  type TimeBlockDto,
} from "./agenda-data";
import { AppointmentForm, BlockForm, RescheduleForm } from "./agenda-forms";
import {
  dayParts,
  formatDayTitle,
  formatWeekTitle,
  localDate,
  localTime,
  rangeOf,
  shiftDate,
  todayIn,
  type AgendaView,
} from "./agenda-time";

// /painel/agenda (guia 3, 7d; D4, D9): agendamentos e bloqueios por dia ou semana, no fuso do
// negócio. Dia: lista por horário com linhas que abrem no lugar (DESIGN.md: rows instead of
// cards) para concluir, remarcar e cancelar, ou remover o bloqueio. Semana: sete colunas no
// desktop e lista por dia no celular. Novo agendamento e bloqueio abrem no topo.

type Entry = { kind: "appointment"; item: AppointmentDto } | { kind: "block"; item: TimeBlockDto };
type RowMode = "details" | "reschedule" | "cancel";

const WIDE = "(min-width: 1024px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Colunas da semana só no desktop; um único render (sem duplicar a lista escondida por CSS).
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}

function entriesOf(data: AgendaRange): Entry[] {
  const entries: Entry[] = [
    ...data.appointments.map((item) => ({ kind: "appointment" as const, item })),
    ...data.timeBlocks.map((item) => ({ kind: "block" as const, item })),
  ];
  return entries.sort((a, b) => a.item.startsAt.localeCompare(b.item.startsAt) || (a.kind === "block" ? -1 : 1));
}

function professionalName(catalog: AgendaCatalog, id: string): string {
  return catalog.professionals.find((professional) => professional.id === id)?.name ?? "Profissional arquivado";
}

function countLabel(data: AgendaRange): string {
  const active = data.appointments.filter((item) => item.status !== "canceled").length;
  const blocks = data.timeBlocks.length;
  const parts = [`${active} ${active === 1 ? "agendamento" : "agendamentos"}`];
  if (blocks > 0) parts.push(`${blocks} ${blocks === 1 ? "bloqueio" : "bloqueios"}`);
  return parts.join(", ");
}

export function AgendaScreen() {
  const { state, reload } = useResource(loadCatalog);
  return (
    <PageFrame>
      {state.status === "ready" ? (
        <Agenda catalog={state.data} />
      ) : (
        <>
          <PageHead title="Agenda" lead="Os agendamentos e bloqueios da sua equipe, por dia ou por semana." />
          <div className="mt-head-gap">
            {state.status === "loading" && <ListSkeleton rows={5} label="Carregando agenda…" />}
            {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
          </div>
        </>
      )}
    </PageFrame>
  );
}

type RangeState = { key: string; status: "ready"; data: AgendaRange } | { key: string; status: "error"; message: string } | null;

function Agenda({ catalog }: { catalog: AgendaCatalog }) {
  const { timezone } = catalog;
  const today = todayIn(timezone);
  const wide = useWide();
  const [view, setView] = useState<AgendaView>("day");
  const [date, setDate] = useState(today);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"appointment" | "block" | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: RowMode } | null>(null);
  const [token, setToken] = useState(0);
  const [range, setRange] = useState<RangeState>(null);

  const { days, from, to } = rangeOf(view, date, timezone);
  const key = `${from}|${to}|${professionalId ?? ""}|${token}`;
  const loading = range?.key !== key;

  useEffect(() => {
    let active = true;
    void loadRange(from, to, professionalId).then((result) => {
      if (!active) return;
      setRange(result.ok ? { key, status: "ready", data: result.data } : { key, status: "error", message: result.message });
    });
    return () => {
      active = false;
    };
  }, [key, from, to, professionalId]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const replaceAppointment = (appointment: AppointmentDto) =>
    setRange((current) =>
      current?.status === "ready"
        ? { ...current, data: { ...current.data, appointments: current.data.appointments.map((item) => (item.id === appointment.id ? appointment : item)) } }
        : current,
    );

  // Depois de criar ou remarcar: vai para o dia do horário, abre a linha e relê o intervalo.
  function showOn(startsAt: string, id: string) {
    setDate(localDate(startsAt, timezone));
    setOpen({ id, mode: "details" });
    refresh();
  }

  const bookable = catalog.services.some((service) =>
    catalog.professionals.some((professional) => catalog.servicesByProfessional[professional.id]?.includes(service.id)),
  );
  const ready = !loading && range?.status === "ready" ? range.data : null;
  const title = view === "day" ? formatDayTitle(date, today) : formatWeekTitle(days);
  const isCurrent = view === "day" ? date === today : days.includes(today);

  return (
    <>
      <PageHead
        title="Agenda"
        lead="Os agendamentos e bloqueios da sua equipe, por dia ou por semana."
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setPanel(panel === "block" ? null : "block")}
              aria-expanded={panel === "block"}
              disabled={catalog.professionals.length === 0}
              className="w-full sm:w-auto"
            >
              <LockIcon aria-hidden="true" />
              Bloquear horário
            </Button>
            <Button
              onClick={() => setPanel(panel === "appointment" ? null : "appointment")}
              aria-expanded={panel === "appointment"}
              disabled={!bookable}
              className="w-full sm:w-auto"
            >
              <CalendarPlusIcon aria-hidden="true" />
              Novo agendamento
            </Button>
          </div>
        }
      />

      <div className="mt-head-gap flex flex-col gap-6">
        {!bookable && (
          <p className="rounded-control bg-tint px-4 py-3 text-small text-ink-2">
            Para agendar, cadastre ao menos um <Link href="/painel/servicos">serviço</Link> e um{" "}
            <Link href="/painel/profissionais">profissional</Link> que o atenda, com os horários de trabalho.
          </p>
        )}

        {panel && (
          <RowPanel>
            {panel === "appointment" ? (
              <AppointmentForm
                catalog={catalog}
                defaultDate={date < today ? today : date}
                defaultProfessionalId={professionalId}
                onCancel={() => setPanel(null)}
                onSaved={(appointment) => {
                  setPanel(null);
                  if (view === "week" && !wide) setView("day");
                  showOn(appointment.startsAt, appointment.id);
                  toast.success(`Agendamento criado: ${appointment.contact.name}, ${whenLabel(appointment.startsAt, timezone)}.`);
                }}
              />
            ) : (
              <BlockForm
                catalog={catalog}
                defaultDate={date < today ? today : date}
                defaultProfessionalId={professionalId}
                onCancel={() => setPanel(null)}
                onSaved={(block) => {
                  setPanel(null);
                  showOn(block.startsAt, block.id);
                  toast.success(`Horário bloqueado: ${professionalName(catalog, block.professionalId)}, ${whenLabel(block.startsAt, timezone)}.`);
                }}
              />
            )}
          </RowPanel>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={view === "day" ? "Dia anterior" : "Semana anterior"}
                onClick={() => setDate(shiftDate(view, date, -1))}
              >
                <ChevronLeftIcon aria-hidden="true" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDate(today)} disabled={isCurrent}>
                Hoje
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={view === "day" ? "Próximo dia" : "Próxima semana"}
                onClick={() => setDate(shiftDate(view, date, 1))}
              >
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ViewToggle view={view} onChange={setView} />
              <div className="relative w-full min-[480px]:w-auto">
                <select
                  aria-label="Profissional"
                  value={professionalId ?? ""}
                  onChange={(event) => setProfessionalId(event.target.value || null)}
                  className={cn(CONTROL, "h-control-sm w-full cursor-pointer appearance-none truncate pr-10 text-small min-[480px]:w-56")}
                >
                  <option value="">Todos os profissionais</option>
                  {catalog.professionals.map((professional) => (
                    <option key={professional.id} value={professional.id}>
                      {professional.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-ink-2" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-title text-ink" aria-live="polite">
              {title}
            </h2>
            <p className="text-small text-ink-2 tabular-nums" aria-live="polite">
              {ready ? countLabel(ready) : " "}
            </p>
          </div>
        </div>

        <div>
          {loading && <ListSkeleton rows={4} label="Carregando agenda…" />}
          {!loading && range?.status === "error" && <LoadError message={range.message} onRetry={refresh} />}
          {ready &&
            (view === "day" ? (
              <DayList
                entries={entriesOf(ready)}
                catalog={catalog}
                open={open}
                setOpen={setOpen}
                onAppointment={replaceAppointment}
                onRescheduled={(appointment) => {
                  showOn(appointment.startsAt, appointment.id);
                  toast.success(`Remarcado: ${appointment.contact.name}, ${whenLabel(appointment.startsAt, timezone)}.`);
                }}
                onBlockRemoved={refresh}
                empty="Nenhum agendamento neste dia."
              />
            ) : wide ? (
              <WeekColumns
                days={days}
                today={today}
                entries={entriesOf(ready)}
                catalog={catalog}
                onPick={(day, id) => {
                  setView("day");
                  setDate(day);
                  setOpen({ id, mode: "details" });
                }}
              />
            ) : (
              <WeekList
                days={days}
                today={today}
                entries={entriesOf(ready)}
                catalog={catalog}
                open={open}
                setOpen={setOpen}
                onAppointment={replaceAppointment}
                onRescheduled={(appointment) => {
                  setView("day");
                  showOn(appointment.startsAt, appointment.id);
                  toast.success(`Remarcado: ${appointment.contact.name}, ${whenLabel(appointment.startsAt, timezone)}.`);
                }}
                onBlockRemoved={refresh}
              />
            ))}
        </div>
      </div>
    </>
  );
}

function whenLabel(iso: string, timezone: string): string {
  const parts = dayParts(localDate(iso, timezone));
  return `${parts.long.toLowerCase()} às ${localTime(iso, timezone)}`;
}

// Dia | Semana (DESIGN.md > interest toggle: pressionado em violet-wash com texto violet-deep).
function ViewToggle({ view, onChange }: { view: AgendaView; onChange: (view: AgendaView) => void }) {
  const options: { value: AgendaView; label: string }[] = [
    { value: "day", label: "Dia" },
    { value: "week", label: "Semana" },
  ];
  return (
    <div role="group" aria-label="Visão da agenda" className="inline-flex overflow-hidden rounded-control border border-line-strong bg-surface">
      {options.map((option) => {
        const pressed = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-chip min-w-20 cursor-pointer items-center justify-center px-4 text-small font-medium transition-colors duration-160 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet",
              pressed ? "bg-violet-wash font-semibold text-violet-deep" : "text-ink-2 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint [@media(hover:hover)_and_(pointer:fine)]:hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusTag({ status }: { status: AppointmentDto["status"] | "block" }) {
  const label = status === "block" ? "Bloqueio" : STATUS_LABEL[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-pill px-2.5 text-micro whitespace-nowrap",
        status === "canceled" ? "text-ink-3 ring-1 ring-line ring-inset" : "bg-ink/7 text-ink",
      )}
    >
      {status === "completed" && <CheckIcon aria-hidden="true" strokeWidth={2.5} className="size-3.5" />}
      {status === "block" && <LockIcon aria-hidden="true" className="size-3.5" />}
      {label}
    </span>
  );
}

interface ListProps {
  catalog: AgendaCatalog;
  open: { id: string; mode: RowMode } | null;
  setOpen: (open: { id: string; mode: RowMode } | null) => void;
  onAppointment: (appointment: AppointmentDto) => void;
  onRescheduled: (appointment: AppointmentDto) => void;
  onBlockRemoved: () => void;
}

function DayList({ entries, empty, ...props }: ListProps & { entries: Entry[]; empty: string }) {
  if (entries.length === 0) {
    return <p className="border-y border-line py-8 text-body text-ink-3">{empty}</p>;
  }
  return (
    <ol className="border-b border-line">
      {entries.map((entry) => (
        <EntryRow key={entry.item.id} entry={entry} {...props} />
      ))}
    </ol>
  );
}

function EntryRow({ entry, catalog, open, setOpen, onAppointment, onRescheduled, onBlockRemoved }: ListProps & { entry: Entry }) {
  const { timezone } = catalog;
  const { item } = entry;
  const isOpen = open?.id === item.id;
  const panelId = `detalhes-${item.id}`;
  const canceled = entry.kind === "appointment" && entry.item.status === "canceled";
  const name = entry.kind === "appointment" ? entry.item.contact.name : "Horário bloqueado";
  const detail =
    entry.kind === "appointment"
      ? `${entry.item.service.name} · ${entry.item.professional.name}`
      : [professionalName(catalog, entry.item.professionalId), entry.item.reason].filter(Boolean).join(" · ");
  const status = entry.kind === "appointment" ? entry.item.status : "block";

  return (
    <li className="border-t border-line">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen(isOpen ? null : { id: item.id, mode: "details" })}
        className={cn(
          "group grid w-full cursor-pointer grid-cols-[3.75rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-control py-4 text-left outline-none transition-colors duration-180 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet sm:grid-cols-[5rem_minmax(0,1fr)_auto_auto] sm:gap-x-5 sm:px-2 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint",
          entry.kind === "block" && "bg-tint",
        )}
      >
        <span className="flex flex-col tabular-nums sm:pl-1">
          <span className={cn("text-body font-semibold", canceled ? "text-ink-3" : "text-ink")}>{localTime(item.startsAt, timezone)}</span>
          <span className="text-small text-ink-3">{localTime(item.endsAt, timezone)}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className={cn("truncate text-body font-semibold", canceled ? "text-ink-3 line-through" : "text-ink")}>{name}</span>
          <span className="truncate text-small text-ink-2">{detail}</span>
          <span className="sm:hidden">
            <StatusTag status={status} />
          </span>
        </span>
        <span className="hidden pt-0.5 sm:block">
          <StatusTag status={status} />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 items-center justify-center rounded-pill border border-line-strong text-ink transition-[background-color,border-color,color,transform] duration-180",
            isOpen && "rotate-180 border-ink bg-ink text-on-dark",
          )}
        >
          <ChevronDownIcon className="size-[18px]" />
        </span>
      </button>
      {isOpen && (
        <div id={panelId} className="pb-5 sm:pl-[6.75rem]">
          <RowPanel>
            {entry.kind === "appointment" ? (
              <AppointmentDetails
                appointment={entry.item}
                catalog={catalog}
                mode={open.mode}
                setMode={(mode) => setOpen({ id: item.id, mode })}
                onAppointment={onAppointment}
                onRescheduled={onRescheduled}
              />
            ) : (
              <BlockDetails block={entry.item} catalog={catalog} onRemoved={onBlockRemoved} />
            )}
          </RowPanel>
        </div>
      )}
    </li>
  );
}

function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-small font-semibold text-ink">{term}</dt>
          <dd className="-mt-2 min-w-0 text-small break-words text-ink-2 sm:mt-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AppointmentDetails({
  appointment,
  catalog,
  mode,
  setMode,
  onAppointment,
  onRescheduled,
}: {
  appointment: AppointmentDto;
  catalog: AgendaCatalog;
  mode: RowMode;
  setMode: (mode: RowMode) => void;
  onAppointment: (appointment: AppointmentDto) => void;
  onRescheduled: (appointment: AppointmentDto) => void;
}) {
  const { timezone } = catalog;
  const [busy, setBusy] = useState<"complete" | "cancel" | null>(null);
  const { contact, service } = appointment;
  const start = localTime(appointment.startsAt, timezone);
  const minutes = Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000);

  async function change(action: "complete" | "cancel") {
    setBusy(action);
    const result = await apiRequest<{ appointment: AppointmentDto }>("POST", `/api/appointments/${appointment.id}/${action}`);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    onAppointment(result.data.appointment);
    setMode("details");
    toast.success(
      action === "complete"
        ? `Atendimento de ${contact.name} marcado como concluído.`
        : `Agendamento de ${contact.name} cancelado. O horário das ${start} ficou livre.`,
    );
  }

  if (mode === "reschedule") {
    return (
      <RescheduleForm
        appointment={appointment}
        catalog={catalog}
        onCancel={() => setMode("details")}
        onSaved={onRescheduled}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailList
        items={[
          ["Cliente", contact.name],
          ["Telefone", <a key="tel" href={`tel:${contact.phone}`}>{formatPhone(contact.phone)}</a>],
          ["Serviço", `${service.name}, ${formatDuration(minutes)}, ${formatCents(service.priceCents)}`],
          ["Profissional", appointment.professional.name],
          ["Horário", `${dayParts(localDate(appointment.startsAt, timezone)).long}, ${start} às ${localTime(appointment.endsAt, timezone)}`],
          ["Situação", STATUS_LABEL[appointment.status]],
        ]}
      />
      {appointment.status === "confirmed" &&
        (mode === "cancel" ? (
          <div role="group" aria-label="Confirmar cancelamento" className="flex flex-col gap-4 rounded-control bg-danger/8 p-4">
            <p className="text-small text-ink">
              Cancelar o agendamento de {contact.name} às {start}? O horário volta a ficar livre para outro cliente.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setMode("details")} disabled={busy !== null} className="w-full sm:w-auto">
                Voltar
              </Button>
              <Button variant="destructive" onClick={() => void change("cancel")} disabled={busy !== null} className="w-full sm:w-auto">
                {busy === "cancel" ? "Cancelando…" : "Sim, cancelar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button variant="destructive" onClick={() => setMode("cancel")} disabled={busy !== null} className="w-full sm:mr-auto sm:w-auto">
              Cancelar agendamento
            </Button>
            <Button variant="outline" onClick={() => setMode("reschedule")} disabled={busy !== null} className="w-full sm:w-auto">
              Remarcar
            </Button>
            <Button onClick={() => void change("complete")} disabled={busy !== null} className="w-full sm:w-auto">
              <CheckIcon aria-hidden="true" />
              {busy === "complete" ? "Salvando…" : "Marcar como concluído"}
            </Button>
          </div>
        ))}
    </div>
  );
}

function BlockDetails({ block, catalog, onRemoved }: { block: TimeBlockDto; catalog: AgendaCatalog; onRemoved: () => void }) {
  const { timezone } = catalog;
  const [busy, setBusy] = useState(false);
  const who = professionalName(catalog, block.professionalId);
  const when = `${localTime(block.startsAt, timezone)} às ${localTime(block.endsAt, timezone)}`;
  const sameDay = localDate(block.startsAt, timezone) === localDate(block.endsAt, timezone);

  async function remove() {
    setBusy(true);
    const result = await apiRequest("DELETE", `/api/time-blocks/${block.id}`);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    onRemoved();
    toast.success(`Bloqueio de ${who} das ${when} removido.`, {
      action: {
        label: "Desfazer",
        onClick: async () => {
          const restored = await apiRequest("POST", "/api/time-blocks", {
            professionalId: block.professionalId,
            startsAt: block.startsAt,
            endsAt: block.endsAt,
            reason: block.reason,
          });
          if (restored.ok) onRemoved();
          else toast.error(restored.message);
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailList
        items={[
          ["Profissional", who],
          [
            "Horário",
            sameDay
              ? `${dayParts(localDate(block.startsAt, timezone)).long}, ${when}`
              : `${dayParts(localDate(block.startsAt, timezone)).long}, ${localTime(block.startsAt, timezone)} até ${dayParts(localDate(block.endsAt, timezone)).long.toLowerCase()}, ${localTime(block.endsAt, timezone)}`,
          ],
          ["Motivo", block.reason ?? "Sem motivo informado"],
        ]}
      />
      <div className="flex sm:justify-end">
        <Button variant="destructive" onClick={() => void remove()} disabled={busy} className="w-full sm:w-auto">
          {busy ? "Removendo…" : "Remover bloqueio"}
        </Button>
      </div>
    </div>
  );
}

// Semana no celular: lista por dia (D9), com as mesmas linhas que abrem no lugar.
function WeekList({ days, today, entries, ...props }: ListProps & { days: string[]; today: string; entries: Entry[] }) {
  const { timezone } = props.catalog;
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => {
        const items = entries.filter((entry) => localDate(entry.item.startsAt, timezone) === day);
        return (
          <section key={day} aria-labelledby={`dia-${day}`} className="flex flex-col gap-3">
            <h3 id={`dia-${day}`} className="flex items-baseline gap-2 text-body font-semibold text-ink">
              {dayParts(day).long}
              {day === today && <span className="text-micro text-ink-2">Hoje</span>}
            </h3>
            <DayList entries={items} empty="Nenhum agendamento." {...props} />
          </section>
        );
      })}
    </div>
  );
}

// Semana no desktop: sete colunas; cada item leva ao dia com a linha aberta.
function WeekColumns({
  days,
  today,
  entries,
  catalog,
  onPick,
}: {
  days: string[];
  today: string;
  entries: Entry[];
  catalog: AgendaCatalog;
  onPick: (day: string, id: string) => void;
}) {
  const { timezone } = catalog;
  return (
    <div className="grid grid-cols-7 border-y border-line">
      {days.map((day, index) => {
        const parts = dayParts(day);
        const items = entries.filter((entry) => localDate(entry.item.startsAt, timezone) === day);
        return (
          <section
            key={day}
            aria-label={parts.long}
            className={cn("flex min-h-72 min-w-0 flex-col gap-2 px-2 pt-3 pb-4", index > 0 && "border-l border-line")}
          >
            <h3 className="flex items-center gap-2 px-1 pb-2 font-sans">
              <span className="text-small font-medium text-ink-2">{parts.weekday}</span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-pill font-heading text-body font-semibold tabular-nums",
                  day === today ? "bg-ink text-on-dark" : "text-ink",
                )}
              >
                {parts.day}
              </span>
            </h3>
            {items.length === 0 && <p className="px-1 text-micro text-ink-3">Livre</p>}
            <ul className="flex flex-col gap-1.5">
              {items.map((entry) => {
                const canceled = entry.kind === "appointment" && entry.item.status === "canceled";
                const label = entry.kind === "appointment" ? entry.item.contact.name : "Bloqueado";
                const sub =
                  entry.kind === "appointment"
                    ? `${entry.item.service.name} · ${entry.item.professional.name}`
                    : professionalName(catalog, entry.item.professionalId);
                const status = entry.kind === "appointment" ? STATUS_LABEL[entry.item.status] : "Bloqueio";
                return (
                  <li key={entry.item.id}>
                    <button
                      type="button"
                      onClick={() => onPick(day, entry.item.id)}
                      aria-label={`${localTime(entry.item.startsAt, timezone)}, ${label}, ${sub}, ${status}`}
                      className={cn(
                        "flex w-full cursor-pointer flex-col gap-0.5 rounded-control px-2.5 py-2 text-left outline-none transition-[background-color,box-shadow] duration-160 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
                        entry.kind === "block"
                          ? "bg-tint ring-1 ring-line ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-line-strong"
                          : canceled
                            ? "ring-1 ring-line ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint"
                            : "bg-surface shadow-rest ring-1 ring-line [@media(hover:hover)_and_(pointer:fine)]:hover:ring-line-strong",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-micro font-semibold text-ink tabular-nums">
                        {entry.kind === "block" && <LockIcon aria-hidden="true" className="size-3" />}
                        {entry.kind === "appointment" && entry.item.status === "completed" && (
                          <CheckIcon aria-hidden="true" strokeWidth={2.5} className="size-3" />
                        )}
                        {localTime(entry.item.startsAt, timezone)}
                      </span>
                      <span className={cn("truncate text-small font-semibold", canceled ? "text-ink-3 line-through" : "text-ink")}>{label}</span>
                      <span className="truncate text-micro text-ink-2">{sub}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
