"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { fieldErrorsOf, focusFirstInvalid } from "@/components/auth/auth-request";
import { Field } from "@/components/auth/field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { workingHoursIntervalSchema } from "@/server/validation/working-hours";
import { apiRequest, type ApiResult, type ProfessionalDto, type WorkingHoursDto } from "./api-client";
import { PageFrame, PageHead } from "./page-head";
import { FormActions, RowPanel } from "./row-panel";
import { EmptyState, ListSkeleton, LoadError } from "./states";
import { useResource } from "./use-resource";

// Semana começando na segunda, como se lê no Brasil. weekday segue o banco: 0 = domingo.
const WEEK = [
  { weekday: 1, name: "Segunda" },
  { weekday: 2, name: "Terça" },
  { weekday: 3, name: "Quarta" },
  { weekday: 4, name: "Quinta" },
  { weekday: 5, name: "Sexta" },
  { weekday: 6, name: "Sábado" },
  { weekday: 0, name: "Domingo" },
] as const;

const dayName = (weekday: number) => WEEK.find((day) => day.weekday === weekday)?.name ?? "";
const intervalLabel = (interval: Pick<WorkingHoursDto, "start" | "end">) => `${interval.start} às ${interval.end}`;
const byStart = (a: WorkingHoursDto, b: WorkingHoursDto) => a.weekday - b.weekday || a.start.localeCompare(b.start);

interface ScreenData {
  professional: ProfessionalDto;
  workingHours: WorkingHoursDto[];
}

async function loadScreen(id: string): Promise<ApiResult<ScreenData>> {
  const [professional, hours] = await Promise.all([
    apiRequest<{ professional: ProfessionalDto }>("GET", `/api/professionals/${id}`),
    apiRequest<{ workingHours: WorkingHoursDto[] }>("GET", `/api/professionals/${id}/working-hours`),
  ]);
  if (!professional.ok) return professional;
  if (!hours.ok) return hours;
  return { ok: true, data: { professional: professional.data.professional, workingHours: hours.data.workingHours } };
}

// /painel/profissionais/[id]/horarios (guia 7c, D5): grade semanal do profissional, vários
// intervalos por dia, sem sobreposição e com fim depois do início. Adicionar e editar no lugar;
// remover apaga de verdade (D6), com "Desfazer" no toast que recria o intervalo.
export function WorkingHoursScreen() {
  const { id } = useParams<{ id: string }>();
  const { state, reload, setData } = useResource(() => loadScreen(id));
  // "novo:<weekday>" ou o id do intervalo em edição. Um formulário aberto por vez.
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function upsert(interval: WorkingHoursDto) {
    setData((data) => ({
      ...data,
      workingHours: [...data.workingHours.filter((item) => item.id !== interval.id), interval].sort(byStart),
    }));
  }

  async function remove(interval: WorkingHoursDto) {
    setBusy(interval.id);
    const result = await apiRequest("DELETE", `/api/working-hours/${interval.id}`);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setData((data) => ({ ...data, workingHours: data.workingHours.filter((item) => item.id !== interval.id) }));
    toast.success(`${dayName(interval.weekday)}, ${intervalLabel(interval)} removido.`, {
      action: {
        label: "Desfazer",
        onClick: async () => {
          const restored = await apiRequest<{ workingHours: WorkingHoursDto }>("POST", `/api/professionals/${id}/working-hours`, {
            weekday: interval.weekday,
            start: interval.start,
            end: interval.end,
          });
          if (restored.ok) upsert(restored.data.workingHours);
          else toast.error(restored.message);
        },
      },
    });
  }

  const backLink = (
    <Link
      href="/painel/profissionais"
      className="-ml-2 mb-4 inline-flex h-chip items-center gap-2 rounded-control px-2 text-small font-medium text-ink-2 no-underline outline-none transition-colors duration-160 focus-visible:outline-2 focus-visible:outline-violet [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint [@media(hover:hover)_and_(pointer:fine)]:hover:text-ink"
    >
      <ArrowLeftIcon className="size-[18px]" aria-hidden="true" />
      Profissionais
    </Link>
  );

  if (state.status === "error" && state.code === "not_found") {
    return (
      <PageFrame>
        <PageHead before={backLink} title="Profissional não encontrado" lead="Ele pode ter sido removido ou o link está incompleto." />
        <div className="mt-head-gap">
          <EmptyState
            title="Nada para mostrar aqui"
            detail="Volte para a lista e abra os horários pelo botão de cada profissional."
            action={
              <Link href="/painel/profissionais" className="text-label">
                Ver profissionais
              </Link>
            }
          />
        </div>
      </PageFrame>
    );
  }

  const ready = state.status === "ready" ? state.data : null;
  const daysWithHours = new Set(ready?.workingHours.map((interval) => interval.weekday));

  return (
    <PageFrame>
      <PageHead
        before={backLink}
        title={ready ? `Horários de ${ready.professional.name}` : "Horários"}
        lead="Os dias e intervalos em que esta pessoa atende. Um dia pode ter mais de um intervalo, como manhã e tarde."
      />

      <div className="mt-head-gap">
        {state.status === "loading" && <ListSkeleton rows={7} label="Carregando horários…" />}
        {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
        {ready && (
          <>
            {ready.professional.archivedAt && (
              <p className="mb-6 rounded-control bg-tint px-4 py-3 text-small text-ink-2">
                Este profissional está arquivado. Os horários ficam guardados, mas não valem enquanto ele não for restaurado.
              </p>
            )}
            <p className="mb-4 text-small text-ink-2" aria-live="polite">
              {daysWithHours.size === 0
                ? "Nenhum dia com atendimento ainda. Comece pelo primeiro dia em que esta pessoa atende."
                : `Atende em ${daysWithHours.size} ${daysWithHours.size === 1 ? "dia" : "dias"} da semana.`}
            </p>
            <ul aria-label="Semana" className="border-b border-line">
              {WEEK.map((day) => {
                const intervals = ready.workingHours.filter((interval) => interval.weekday === day.weekday);
                return (
                  <li key={day.weekday} className="border-t border-line py-5">
                    <section aria-labelledby={`dia-${day.weekday}`} className="grid gap-3 sm:grid-cols-[9rem_1fr] sm:gap-6">
                      <h2 id={`dia-${day.weekday}`} className="pt-2 text-title text-ink">
                        {day.name}
                      </h2>
                      <div className="flex min-w-0 flex-col gap-2">
                        {intervals.length === 0 && open !== `novo:${day.weekday}` && (
                          <p className="py-2 text-small text-ink-3">Sem atendimento</p>
                        )}
                        {intervals.length > 0 && (
                          <ul className="flex flex-col gap-1">
                            {intervals.map((interval) =>
                              open === interval.id ? (
                                <li key={interval.id}>
                                  <IntervalForm
                                    professionalId={id}
                                    weekday={day.weekday}
                                    interval={interval}
                                    onCancel={() => setOpen(null)}
                                    onSaved={(saved) => {
                                      upsert(saved);
                                      setOpen(null);
                                      toast.success("Horário salvo.");
                                    }}
                                  />
                                </li>
                              ) : (
                                <li key={interval.id} className="flex items-center gap-2">
                                  <span className="flex-1 text-body font-medium text-ink tabular-nums">{intervalLabel(interval)}</span>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => setOpen(interval.id)}
                                    aria-label={`Editar ${day.name}, ${intervalLabel(interval)}`}
                                  >
                                    <PencilIcon aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => void remove(interval)}
                                    disabled={busy === interval.id}
                                    aria-label={`Remover ${day.name}, ${intervalLabel(interval)}`}
                                  >
                                    <Trash2Icon aria-hidden="true" />
                                  </Button>
                                </li>
                              ),
                            )}
                          </ul>
                        )}
                        {open === `novo:${day.weekday}` ? (
                          <IntervalForm
                            professionalId={id}
                            weekday={day.weekday}
                            suggestion={intervals.at(-1)}
                            onCancel={() => setOpen(null)}
                            onSaved={(saved) => {
                              upsert(saved);
                              setOpen(null);
                              toast.success(`${day.name}, ${intervalLabel(saved)} adicionado.`);
                            }}
                          />
                        ) : (
                          <div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setOpen(`novo:${day.weekday}`)}
                              aria-label={`Adicionar intervalo ${day.weekday === 0 || day.weekday === 6 ? "no" : "na"} ${day.name.toLowerCase()}`}
                            >
                              <PlusIcon aria-hidden="true" />
                              Adicionar intervalo
                            </Button>
                          </div>
                        )}
                      </div>
                    </section>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </PageFrame>
  );
}

type IntervalField = "start" | "end";

// Início e fim no fuso do negócio, "HH:MM". Mesmo schema Zod da API antes de enviar; sobreposição
// com outro intervalo do dia vem do servidor (409) e aparece no alerta.
function IntervalForm({
  professionalId,
  weekday,
  interval,
  suggestion,
  onSaved,
  onCancel,
}: {
  professionalId: string;
  weekday: number;
  interval?: WorkingHoursDto;
  suggestion?: WorkingHoursDto;
  onSaved: (interval: WorkingHoursDto) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<IntervalField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);
  // Segundo intervalo do dia: sugere começar onde o anterior termina.
  const defaults = interval ?? (suggestion ? { start: suggestion.end, end: "" } : { start: "09:00", end: "18:00" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const body = { weekday, start: String(data.get("start") ?? ""), end: String(data.get("end") ?? "") };
    const parsed = workingHoursIntervalSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = fieldErrorsOf<IntervalField>(parsed.error);
      if (body.start === "") fieldErrors.start = "Informe o início.";
      if (body.end === "") fieldErrors.end = "Informe o fim.";
      setErrors(fieldErrors);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    setErrors({});
    setPending(true);
    const result = interval
      ? await apiRequest<{ workingHours: WorkingHoursDto }>("PATCH", `/api/working-hours/${interval.id}`, body)
      : await apiRequest<{ workingHours: WorkingHoursDto }>("POST", `/api/professionals/${professionalId}/working-hours`, body);
    setPending(false);
    if (result.ok) onSaved(result.data.workingHours);
    else setAlert(result.message);
  }

  return (
    <RowPanel className="mt-1">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        aria-label={interval ? `Editar intervalo de ${dayName(weekday)}` : `Novo intervalo de ${dayName(weekday)}`}
        className="flex flex-col gap-6"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field
            name="start"
            label="Início"
            type="time"
            defaultValue={defaults.start}
            error={errors.start}
            onChange={() => setErrors((current) => ({ ...current, start: undefined }))}
            autoFocus
          />
          <Field
            name="end"
            label="Fim"
            type="time"
            defaultValue={defaults.end}
            error={errors.end}
            onChange={() => setErrors((current) => ({ ...current, end: undefined }))}
          />
        </div>
        {alert && <FormAlert message={alert} />}
        <FormActions
          pending={pending}
          submitLabel={interval ? "Salvar horário" : "Adicionar"}
          pendingLabel="Salvando…"
          onCancel={onCancel}
        />
      </form>
    </RowPanel>
  );
}
