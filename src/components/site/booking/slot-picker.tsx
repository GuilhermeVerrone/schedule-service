"use client";

import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadDaySlots, type PublicSlot } from "./booking-api";
import { dayButton, lastBookableDay, lastPage, localTime, monthsLabel, pageOf, todayIn, weekDays } from "./booking-format";

// Escolha de dia e horário (guia 6, 7a, 7c): uma semana por vez a partir de hoje, até a janela
// máxima do negócio. Os 7 dias da semana visível são lidos juntos para marcar os dias sem
// horário livre; o primeiro dia com horário já vem escolhido. `refreshKey` novo (depois de um
// 409, D8) descarta o que foi lido e busca de novo.

export interface PickedSlot {
  date: string;
  startsAt: string;
}

type DayState = { status: "loading" } | { status: "ready"; slots: PublicSlot[] } | { status: "error"; message: string };

const CHIP =
  "flex cursor-pointer items-center justify-center rounded-pill border tabular-nums transition-[background-color,border-color,color,transform] duration-160 ease-brand-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet active:scale-97 disabled:cursor-default disabled:active:scale-100";
const CHIP_IDLE = "border-line-strong bg-surface text-ink [@media(hover:hover)_and_(pointer:fine)]:hover:border-ink";
const CHIP_ON = "border-violet bg-violet text-on-dark [@media(hover:hover)_and_(pointer:fine)]:hover:bg-violet-deep";

const PERIODS = [
  { label: "Manhã", until: 12 },
  { label: "Tarde", until: 18 },
  { label: "Noite", until: 24 },
] as const;

function byPeriod(slots: PublicSlot[], timezone: string) {
  const groups = PERIODS.map((period) => ({ label: period.label, times: [] as { startsAt: string; time: string }[] }));
  for (const slot of slots) {
    const time = localTime(slot.startsAt, timezone);
    const hour = Number(time.slice(0, 2));
    groups[PERIODS.findIndex((period) => hour < period.until)].times.push({ startsAt: slot.startsAt, time });
  }
  return groups.filter((group) => group.times.length > 0);
}

export function SlotPicker({
  slug,
  serviceId,
  professionalId,
  timezone,
  maxWindowDays,
  value,
  initialDate,
  refreshKey,
  onPick,
}: {
  slug: string;
  serviceId: string;
  // null: "qualquer profissional disponível".
  professionalId: string | null;
  timezone: string;
  maxWindowDays: number;
  value: PickedSlot | null;
  initialDate?: string | null;
  refreshKey: number;
  onPick: (slot: PickedSlot) => void;
}) {
  const [today] = useState(() => todayIn(timezone));
  const lastDay = lastBookableDay(today, maxWindowDays);
  const [page, setPage] = useState(() => (initialDate ? Math.min(pageOf(today, initialDate), lastPage(today, maxWindowDays)) : 0));
  const [chosenDate, setChosenDate] = useState<string | null>(initialDate ?? null);
  const [days, setDays] = useState<Record<string, DayState>>({});
  const [retry, setRetry] = useState(0);

  const visible = weekDays(today, page);
  const bookable = visible.filter((date) => date <= lastDay);
  const queryKey = `${serviceId}|${professionalId ?? ""}|${refreshKey}|${retry}`;
  const keyOf = (date: string) => `${queryKey}|${date}`;

  useEffect(() => {
    let active = true;
    const pending = weekDays(today, page).filter((date) => date <= lastDay);
    for (const date of pending) {
      const key = `${queryKey}|${date}`;
      void loadDaySlots(slug, { serviceId, date, professionalId }).then((result) => {
        if (!active) return;
        setDays((current) => ({
          ...current,
          [key]: result.ok ? { status: "ready", slots: result.data } : { status: "error", message: result.message },
        }));
      });
    }
    return () => {
      active = false;
    };
  }, [slug, serviceId, professionalId, page, queryKey, today, lastDay]);

  const stateOf = (date: string): DayState => days[keyOf(date)] ?? { status: "loading" };
  const weekLoaded = bookable.every((date) => stateOf(date).status !== "loading");
  // Dia escolhido: o do cliente, se estiver na semana; senão o primeiro com horário livre.
  const date =
    chosenDate && visible.includes(chosenDate)
      ? chosenDate
      : weekLoaded
        ? (bookable.find((day) => {
            const state = stateOf(day);
            return state.status === "ready" && state.slots.length > 0;
          }) ?? bookable[0] ?? null)
        : null;
  const day = date ? stateOf(date) : null;
  const goTo = (next: number) => {
    setPage(next);
    setChosenDate(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-small font-semibold text-ink" id="semana-visivel" aria-live="polite">
            {monthsLabel(visible)}
          </p>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Semana anterior" disabled={page === 0} onClick={() => goTo(page - 1)}>
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Próxima semana"
              disabled={page >= lastPage(today, maxWindowDays)}
              onClick={() => goTo(page + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
        <ul aria-label="Dias" className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {visible.map((item) => {
            const parts = dayButton(item);
            const state = stateOf(item);
            const outside = item > lastDay;
            const empty = state.status === "ready" && state.slots.length === 0;
            const selected = item === date;
            const status = outside ? "fora da janela de agendamento" : state.status === "loading" ? "carregando" : empty ? "sem horários livres" : null;
            return (
              <li key={item}>
                <button
                  type="button"
                  disabled={outside}
                  aria-pressed={selected}
                  aria-label={`${parts.long}${status ? `, ${status}` : ""}`}
                  onClick={() => setChosenDate(item)}
                  className={cn(
                    CHIP,
                    "h-auto w-full flex-col gap-0.5 rounded-control py-2.5",
                    selected ? CHIP_ON : CHIP_IDLE,
                    (empty || outside) && !selected && "border-line text-ink-3",
                    outside && "opacity-60",
                  )}
                >
                  <span className={cn("text-micro", selected ? "text-on-dark" : "text-ink-2", (empty || outside) && !selected && "text-ink-3")}>
                    {parts.weekday}
                  </span>
                  <span className="font-heading text-title leading-none">{parts.day}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div aria-live="polite" aria-busy={!day || day.status === "loading"}>
        {!date || !day || day.status === "loading" ? (
          <p role="status" className="text-small text-ink-3">
            Carregando horários livres…
          </p>
        ) : day.status === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-small text-ink">Não foi possível carregar os horários. {day.message}</p>
            <Button variant="outline" size="sm" onClick={() => setRetry((count) => count + 1)}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <h3 className="font-sans text-label text-ink" id="horarios-do-dia">
              {dayButton(date).long}
            </h3>
            {day.slots.length === 0 ? (
              <p className="text-small text-ink-2">
                Nenhum horário livre neste dia. Escolha outro dia
                {page < lastPage(today, maxWindowDays) ? " ou veja a próxima semana" : ""}.
              </p>
            ) : (
              byPeriod(day.slots, timezone).map((group) => (
                <div key={group.label} className="flex flex-col gap-2.5">
                  <p className="text-micro text-ink-2">{group.label}</p>
                  <ul aria-label={`Horários livres: ${group.label.toLowerCase()}`} className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2">
                    {group.times.map(({ startsAt, time }) => {
                      const selected = value?.startsAt === startsAt;
                      return (
                        <li key={startsAt}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onPick({ date, startsAt })}
                            className={cn(CHIP, "h-chip w-full gap-1.5 px-3 text-small font-medium", selected ? CHIP_ON : CHIP_IDLE)}
                          >
                            {selected && <CheckIcon aria-hidden="true" strokeWidth={2.5} className="size-[15px]" />}
                            {time}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
