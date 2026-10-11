"use client";

import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/auth/form-alert";
import { formatCents } from "@/components/painel/catalog/money";
import { telHref } from "@/components/site/site-nav-items";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PublicBusiness, PublicProfessional } from "@/server/repositories/public-repository";
import {
  cancelAppointment,
  isSlotTaken,
  loadAppointment,
  rescheduleAppointment,
  STATUS_LABEL,
  type PublicAppointment,
} from "./booking-api";
import { formatDeadline, formatLongDate, formatWhen, localDate, localTime } from "./booking-format";
import { Notice, Summary } from "./booking-parts";
import { SlotPicker, type PickedSlot } from "./slot-picker";

// Gestão pelo link /{slug}/agendamento/{token} (guia 7c; D6, D8): ver, cancelar e remarcar até o
// prazo do negócio. Token inválido ou de outro negócio aparece como "não encontrado", sem dizer
// qual dos casos. Remarcar mantém o mesmo link; horário que acabou de ficar indisponível (409)
// mostra o aviso e recarrega os horários.

export type ManageBusiness = Pick<PublicBusiness, "slug" | "name" | "phone" | "timezone" | "maxWindowDays">;

type LoadState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ready"; appointment: PublicAppointment };

type Mode = "view" | "cancel" | "reschedule";

const SLOT_TAKEN = "Esse horário acabou de ser reservado por outra pessoa. Os horários foram atualizados: escolha outro.";

function StatusTag({ status }: { status: PublicAppointment["status"] }) {
  return (
    <span className="inline-flex h-7 items-center rounded-pill bg-ink/7 px-3 text-micro font-semibold text-ink">
      {STATUS_LABEL[status]}
    </span>
  );
}

function ContactLine({ business }: { business: ManageBusiness }) {
  const tel = business.phone ? telHref(business.phone) : null;
  if (!business.phone) return <>Fale direto com {business.name}.</>;
  return (
    <>
      Fale com {business.name} pelo telefone{" "}
      {tel ? (
        <a href={tel} className="font-semibold underline-offset-4 hover:underline">
          {business.phone}
        </a>
      ) : (
        business.phone
      )}
      .
    </>
  );
}

export function ManageAppointment({
  business,
  token,
  professionals,
}: {
  business: ManageBusiness;
  token: string;
  professionals: PublicProfessional[];
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [mode, setMode] = useState<Mode>("view");
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    void loadAppointment(business.slug, token).then((result) => {
      if (!active) return;
      if (result.ok) setState({ status: "ready", appointment: result.data });
      else if (result.status === 404) setState({ status: "not_found" });
      else setState({ status: "error", message: result.message });
    });
    return () => {
      active = false;
    };
  }, [business.slug, token, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  const finish = (appointment: PublicAppointment, message: string) => {
    setState({ status: "ready", appointment });
    setMode("view");
    setAlert(null);
    toast.success(message);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  // Prazo vencido ou status mudado no painel enquanto a página estava aberta: relê o agendamento.
  const handleFailure = (result: { code: string; message: string }) => {
    setAlert(result.message);
    if (result.code === "deadline_passed" || result.code === "invalid_status") {
      setMode("view");
      reload();
    }
  };

  const confirmCancel = async () => {
    setPending(true);
    const result = await cancelAppointment(business.slug, token);
    setPending(false);
    if (result.ok) finish(result.data, "Agendamento cancelado.");
    else handleFailure(result);
  };

  if (state.status === "loading") {
    return (
      <p role="status" className="text-body text-ink-3">
        Carregando seu agendamento…
      </p>
    );
  }

  if (state.status === "not_found") {
    return (
      <div className="flex max-w-[48rem] flex-col items-start gap-4">
        <h1 className="text-headline text-ink">Agendamento não encontrado</h1>
        <p className="max-w-[60ch] text-lead text-ink-2">
          Confira se o link foi copiado inteiro. Se o problema continuar, <ContactLine business={business} />
        </p>
        <Link href={`/${business.slug}/agendar`} className={buttonVariants({ className: "mt-2 w-full sm:w-auto" })}>
          Agendar um horário
        </Link>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex max-w-[48rem] flex-col items-start gap-4">
        <h1 className="text-headline text-ink">Seu agendamento</h1>
        <FormAlert message={`Não foi possível carregar o agendamento. ${state.message}`} />
        <Button variant="outline" onClick={reload}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  const { appointment } = state;
  const { timezone } = business;
  const team = professionals.filter((professional) => professional.serviceIds.includes(appointment.service.id));
  const canReschedule = appointment.canManage && team.length > 0;

  return (
    <div className="max-w-[48rem]">
      <div className="flex flex-col items-start gap-3">
        <StatusTag status={appointment.status} />
        <h1 ref={headingRef} tabIndex={-1} className="text-headline text-ink outline-none">
          Seu agendamento
        </h1>
        <p className="max-w-[60ch] text-lead text-ink-2">
          {appointment.status === "canceled"
            ? `${appointment.contact.name}, este agendamento foi cancelado.`
            : appointment.status === "completed"
              ? `${appointment.contact.name}, este atendimento já foi concluído.`
              : `${appointment.contact.name}, seu horário em ${business.name} está confirmado.`}
        </p>
      </div>

      <div className="mt-8">
        <Summary
          label="Detalhes do agendamento"
          rows={[
            { label: "Serviço", value: appointment.service.name },
            { label: "Profissional", value: appointment.professional.name },
            {
              label: "Quando",
              value: (
                <span className={appointment.status === "canceled" ? "text-ink-2 line-through" : undefined}>
                  {formatWhen(appointment.startsAt, appointment.endsAt, timezone)}
                </span>
              ),
            },
            { label: "Valor", value: formatCents(appointment.service.priceCents) },
          ]}
        />
      </div>

      <div className="mt-8 flex flex-col gap-5">
        {alert && <FormAlert message={alert} />}

        {appointment.status === "confirmed" && appointment.canManage && mode === "view" && (
          <>
            <Notice>Você pode cancelar ou remarcar até {formatDeadline(appointment.manageableUntil, timezone)}.</Notice>
            <div className="flex flex-col gap-3 sm:flex-row">
              {canReschedule && (
                <Button className="w-full sm:w-auto" onClick={() => { setAlert(null); setMode("reschedule"); }}>
                  Remarcar
                </Button>
              )}
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setAlert(null); setMode("cancel"); }}>
                Cancelar agendamento
              </Button>
            </div>
          </>
        )}

        {appointment.status === "confirmed" && !appointment.canManage && (
          <Notice title="O prazo para mudar pelo link terminou.">
            Cancelar ou remarcar pelo link só até {formatDeadline(appointment.manageableUntil, timezone)}. Para mudar este horário,{" "}
            <ContactLine business={business} />
          </Notice>
        )}

        {appointment.status === "canceled" && (
          <div className="flex flex-col items-start gap-4">
            <p className="text-body text-ink-2">O horário ficou livre para outra pessoa.</p>
            <Link href={`/${business.slug}/agendar`} className={buttonVariants({ className: "w-full sm:w-auto" })}>
              Agendar outro horário
            </Link>
          </div>
        )}

        {mode === "cancel" && appointment.canManage && (
          <section aria-labelledby="cancelar-titulo" className="flex flex-col gap-4 rounded-frame border border-line bg-surface p-5 sm:p-6">
            <h2 id="cancelar-titulo" className="text-title text-ink">
              Cancelar este agendamento?
            </h2>
            <p className="text-body text-ink-2">
              {appointment.service.name} em {formatLongDate(appointment.startsAt, timezone).toLowerCase()}, às{" "}
              {localTime(appointment.startsAt, timezone)}. O horário fica livre para outra pessoa e não dá para desfazer.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="destructive" disabled={pending} onClick={confirmCancel} className="w-full sm:w-auto">
                {pending ? "Cancelando…" : "Sim, cancelar"}
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setMode("view")} className="w-full sm:w-auto">
                Manter agendamento
              </Button>
            </div>
          </section>
        )}

        {mode === "reschedule" && canReschedule && (
          <Reschedule
            business={business}
            token={token}
            appointment={appointment}
            team={team}
            onDone={(updated) => finish(updated, "Agendamento remarcado.")}
            onFailure={handleFailure}
            onClose={() => {
              setAlert(null);
              setMode("view");
            }}
          />
        )}
      </div>
    </div>
  );
}

function Reschedule({
  business,
  token,
  appointment,
  team,
  onDone,
  onFailure,
  onClose,
}: {
  business: ManageBusiness;
  token: string;
  appointment: PublicAppointment;
  team: PublicProfessional[];
  onDone: (appointment: PublicAppointment) => void;
  onFailure: (result: { code: string; message: string }) => void;
  onClose: () => void;
}) {
  const { timezone } = business;
  const [professionalId, setProfessionalId] = useState(
    team.some((item) => item.id === appointment.professional.id) ? appointment.professional.id : team[0].id,
  );
  const [picked, setPicked] = useState<PickedSlot | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [slotAlert, setSlotAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const professional = team.find((item) => item.id === professionalId)!;

  const pick = (slot: PickedSlot) => {
    setPicked(slot);
    setSlotAlert(null);
    requestAnimationFrame(() => confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const submit = async () => {
    if (!picked) return;
    setPending(true);
    const result = await rescheduleAppointment(business.slug, token, { startsAt: picked.startsAt, professionalId });
    setPending(false);
    if (result.ok) return onDone(result.data);
    if (isSlotTaken(result)) {
      setPicked(null);
      setSlotAlert(SLOT_TAKEN);
      setRefreshKey((key) => key + 1);
      return;
    }
    onFailure(result);
  };

  return (
    <section aria-labelledby="remarcar-titulo" className="flex flex-col gap-6 rounded-frame border border-line bg-surface p-5 sm:p-6">
      <div>
        <h2 id="remarcar-titulo" className="text-title text-ink">
          Remarcar
        </h2>
        <p className="mt-1 text-small text-ink-2">Escolha o novo dia e horário. O link continua o mesmo.</p>
      </div>

      {team.length > 1 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-small font-semibold text-ink" id="remarcar-com">
            Com quem
          </p>
          <ul aria-labelledby="remarcar-com" className="flex flex-wrap gap-2">
            {team.map((item) => {
              const selected = item.id === professionalId;
              return (
                <li key={item.id} className="max-w-full">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setProfessionalId(item.id);
                      setPicked(null);
                    }}
                    className={cn(
                      "flex h-chip max-w-full cursor-pointer items-center gap-1.5 rounded-pill border px-3.5 text-small font-medium transition-[background-color,border-color,color,transform] duration-160 ease-brand-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet active:scale-97",
                      selected
                        ? "border-violet bg-violet text-on-dark [@media(hover:hover)_and_(pointer:fine)]:hover:bg-violet-deep"
                        : "border-line-strong bg-surface text-ink [@media(hover:hover)_and_(pointer:fine)]:hover:border-ink",
                    )}
                  >
                    {selected && <CheckIcon aria-hidden="true" strokeWidth={2.5} className="size-[15px] shrink-0" />}
                    <span className="truncate">{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {slotAlert && <FormAlert message={slotAlert} />}

      <SlotPicker
        key={professionalId}
        slug={business.slug}
        serviceId={appointment.service.id}
        professionalId={professionalId}
        timezone={timezone}
        maxWindowDays={business.maxWindowDays}
        value={picked}
        initialDate={picked?.date ?? localDate(appointment.startsAt, timezone)}
        refreshKey={refreshKey}
        onPick={pick}
      />

      <div ref={confirmRef} className="flex flex-col gap-4 border-t border-line pt-5">
        <p className="text-body text-ink" aria-live="polite">
          {picked ? (
            <>
              Novo horário: <strong className="font-semibold">{formatLongDate(picked.startsAt, timezone)}, às {localTime(picked.startsAt, timezone)}</strong>, com {professional.name}.
            </>
          ) : (
            <span className="text-ink-2">Escolha um horário livre acima.</span>
          )}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button disabled={!picked || pending} onClick={submit} className="w-full sm:w-auto">
            {pending ? "Remarcando…" : "Confirmar remarcação"}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onClose} className="w-full sm:w-auto">
            Desistir
          </Button>
        </div>
      </div>
    </section>
  );
}
