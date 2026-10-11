"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Peças do agendar e da gestão pelo link (DESIGN.md > Services Index, Chips, Inputs): escolhas em
// linhas entre réguas de 1px em vez de cards, resumo em lista de definição, checkbox de 22px.

const HOVER_ROW = "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint";

// Progresso: "Passo 2 de 4" e um traço por passo (grafite até o atual, régua depois).
export function StepProgress({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <div className="mb-8">
      <p className="text-small text-ink-2">
        Passo {current + 1} de {steps.length}
        <span className="text-ink-3" aria-hidden="true">
          {"  ·  "}
        </span>
        <span className="sr-only">: </span>
        <span className="font-semibold text-ink">{steps[current]}</span>
      </p>
      <ol aria-label="Passos do agendamento" className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => (
          <li key={step} aria-current={index === current ? "step" : undefined}>
            <span className="sr-only">
              {step}
              {index < current ? " (feito)" : index === current ? " (atual)" : ""}
            </span>
            <span
              aria-hidden="true"
              className={cn("block h-1 rounded-pill transition-colors duration-180", index <= current ? "bg-ink" : "bg-line")}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface ChoiceItem {
  id: string;
  title: string;
  detail?: string;
  meta?: ReactNode;
}

// Lista de escolhas: cada linha é um botão de largura total; a escolhida mostra o check violeta.
export function ChoiceList({
  label,
  items,
  selectedId,
  onChoose,
}: {
  label: string;
  items: readonly ChoiceItem[];
  selectedId?: string | null;
  onChoose: (id: string) => void;
}) {
  return (
    <ul aria-label={label} className="border-b border-line">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <li key={item.id} className="border-t border-line">
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onChoose(item.id)}
              className={cn(
                "-mx-3 grid w-[calc(100%+1.5rem)] cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-control px-3 py-5 text-left transition-[background-color,transform] duration-160 ease-brand-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet active:scale-[0.99] sm:grid-cols-[1fr_auto_auto]",
                HOVER_ROW,
              )}
            >
              <span className="min-w-0">
                <span className="block font-heading text-title break-words text-ink">{item.title}</span>
                {item.detail && <span className="mt-1 block text-small text-ink-2">{item.detail}</span>}
              </span>
              {item.meta && (
                <span className="col-start-1 row-start-2 text-body text-ink tabular-nums sm:col-start-2 sm:row-start-1 sm:text-right">
                  {item.meta}
                </span>
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "col-start-2 row-span-2 row-start-1 flex size-chip items-center justify-center rounded-pill border transition-colors duration-160 sm:col-start-3 sm:row-span-1",
                  selected ? "border-violet bg-violet text-on-dark" : "border-line-strong text-ink-2",
                )}
              >
                {selected ? <CheckIcon strokeWidth={2.5} className="size-[18px]" /> : <ChevronRightIcon className="size-[18px]" />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface SummaryRow {
  label: string;
  value: ReactNode;
  onChange?: () => void;
  changeLabel?: string;
}

// Resumo do que foi escolhido, com "Alterar" levando de volta ao passo.
export function Summary({ rows, label }: { rows: readonly SummaryRow[]; label: string }) {
  return (
    <dl aria-label={label} className="border-b border-line">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-4 border-t border-line py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-6">
            <dt className="text-small font-semibold text-ink sm:w-36 sm:shrink-0 sm:pt-0.5">{row.label}</dt>
            <dd className="min-w-0 text-body break-words text-ink">{row.value}</dd>
          </div>
          {row.onChange && (
            <button
              type="button"
              onClick={row.onChange}
              aria-label={row.changeLabel}
              className="-my-1 shrink-0 cursor-pointer rounded-control px-2 py-1 text-small font-semibold text-violet-deep underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-violet"
            >
              Alterar
            </button>
          )}
        </div>
      ))}
    </dl>
  );
}

// Checkbox de verdade (DESIGN.md > Inputs > Checkbox): 22px, raio 6px, violeta quando marcado.
export function Checkbox({
  name,
  checked,
  onChange,
  error,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  children: ReactNode;
}) {
  const id = `campo-${name}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="group flex cursor-pointer items-start gap-3 text-small text-ink">
        <span className="relative mt-px flex size-[22px] shrink-0 items-center justify-center">
          <input
            id={id}
            name={name}
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-erro` : undefined}
            className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-sheet bg-surface ring-1 ring-line-strong transition-[background-color,box-shadow] duration-160 ring-inset outline-none checked:bg-violet checked:ring-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet aria-invalid:ring-danger"
          />
          <CheckIcon
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none relative size-0 text-on-dark transition-[width,height] duration-160 ease-brand-out peer-checked:size-[15px]"
          />
        </span>
        <span className="min-w-0">{children}</span>
      </label>
      {error && (
        <p id={`${id}-erro`} className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// Aviso neutro em placa tint (sem violeta): prazos e o "guarde este link".
export function Notice({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-control bg-tint px-4 py-3.5 text-small text-ink-2">
      {title && <p className="font-semibold text-ink">{title}</p>}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}
