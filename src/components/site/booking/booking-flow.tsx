"use client";

import { ArrowLeftIcon, CopyIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { toast } from "sonner";
import { focusFirstInvalid } from "@/components/auth/auth-request";
import { Field } from "@/components/auth/field";
import { FormAlert } from "@/components/auth/form-alert";
import { formatCents, formatDuration } from "@/components/painel/catalog/money";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PublicBusiness, PublicProfessional, PublicService } from "@/server/repositories/public-repository";
import { createBooking, isSlotTaken, type BookingCreated } from "./booking-api";
import { formatDeadline, formatLongDate, formatWhen, isValidEmail, isValidPhone, localTime } from "./booking-format";
import { Checkbox, ChoiceList, Notice, StepProgress, Summary, type ChoiceItem } from "./booking-parts";
import { SlotPicker, type PickedSlot } from "./slot-picker";

// Agendar pelo site (guia 7a, 7b; D5, D6, D8): serviço, profissional ou "qualquer", dia e
// horário, dados e consentimento, e a confirmação com o link de gestão. Horário que acabou de
// ficar indisponível (409) volta ao passo de horário com o aviso e os horários recarregados.

export type BookingBusiness = Pick<PublicBusiness, "slug" | "name" | "timezone" | "maxWindowDays" | "cancelDeadlineMinutes">;

const STEPS = ["Serviço", "Profissional", "Dia e horário", "Seus dados"] as const;
type Step = 0 | 1 | 2 | 3 | "done";

const ANY = "qualquer";

type FormField = "name" | "phone" | "email" | "consent";

const SLOT_TAKEN = "Esse horário acabou de ser reservado por outra pessoa. Os horários foram atualizados: escolha outro.";

function serviceMeta(service: PublicService) {
  return (
    <>
      {formatDuration(service.durationMinutes)}
      <span className="text-ink-3" aria-hidden="true">
        {"  ·  "}
      </span>
      <span className="sr-only">, </span>
      <span className="font-semibold">{formatCents(service.priceCents)}</span>
    </>
  );
}

export function BookingFlow({
  business,
  services,
  professionals,
}: {
  business: BookingBusiness;
  services: PublicService[];
  professionals: PublicProfessional[];
}) {
  const [step, setStep] = useState<Step>(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  // undefined: ainda não escolheu; null: qualquer profissional disponível.
  const [professionalId, setProfessionalId] = useState<string | null | undefined>(undefined);
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  // Dia em que o cliente estava: depois de um 409 a escolha volta para ele, já sem o horário.
  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [slotAlert, setSlotAlert] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", consent: false });
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<BookingCreated | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Só depois da primeira escolha: ao abrir a página, o foco fica onde o navegador o deixou.
  const [moved, setMoved] = useState(false);

  // A cada passo, o foco vai para o título (leitor de tela) e a página volta ao topo do fluxo.
  useEffect(() => {
    if (!moved) return;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start" });
  }, [step, moved]);

  const go = (next: Step) => {
    setMoved(true);
    setStep(next);
  };

  const service = services.find((item) => item.id === serviceId) ?? null;
  const team = service ? professionals.filter((professional) => service.professionalIds.includes(professional.id)) : [];
  const professional = professionalId ? (team.find((item) => item.id === professionalId) ?? null) : null;
  const { timezone } = business;

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 border-y border-line py-[clamp(2rem,1.5rem+2vw,3.5rem)]">
        <h2 className="text-title text-ink">Nenhum serviço disponível para agendar.</h2>
        <p className="max-w-[52ch] text-body text-ink-2">
          Este negócio ainda não publicou os serviços. Volte mais tarde ou fale direto com ele.
        </p>
      </div>
    );
  }

  const chooseService = (id: string) => {
    if (id !== serviceId) {
      setServiceId(id);
      setProfessionalId(undefined);
      setSlot(null);
      setPickerDate(null);
    }
    go(1);
  };

  const chooseProfessional = (id: string) => {
    const next = id === ANY ? null : id;
    if (next !== professionalId) {
      setSlot(null);
      setPickerDate(null);
    }
    setProfessionalId(next);
    setSlotAlert(null);
    go(2);
  };

  const pickSlot = (picked: PickedSlot) => {
    setSlot(picked);
    setPickerDate(picked.date);
    setSlotAlert(null);
    go(3);
  };

  const validate = (): Partial<Record<FormField, string>> => {
    const found: Partial<Record<FormField, string>> = {};
    if (form.name.trim().length < 2) found.name = "Informe seu nome.";
    if (!isValidPhone(form.phone)) found.phone = "Informe seu telefone com DDD, como (11) 98765-4321.";
    if (form.email.trim() && !isValidEmail(form.email)) found.email = "E-mail inválido.";
    if (!form.consent) found.consent = "É preciso aceitar o uso dos seus dados para agendar.";
    return found;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!service || !slot || professionalId === undefined) return;
    const found = validate();
    setErrors(found);
    setAlert(null);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setPending(true);
    const result = await createBooking(business.slug, {
      serviceId: service.id,
      professionalId,
      startsAt: slot.startsAt,
      customer: { name: form.name.trim(), phone: form.phone, email: form.email.trim() || null },
      consent: true,
    });
    setPending(false);
    if (result.ok) {
      setCreated(result.data);
      go("done");
      return;
    }
    if (isSlotTaken(result)) {
      // Outro cliente levou o horário (D8): volta à escolha com o aviso e os horários do dia relidos.
      setSlot(null);
      setSlotAlert(SLOT_TAKEN);
      setRefreshKey((key) => key + 1);
      go(2);
      return;
    }
    setAlert(result.message);
  };

  const back = typeof step === "number" && step > 0 ? () => go((step - 1) as Step) : null;

  if (step === "done" && created) {
    return <BookingDone business={business} created={created} headingRef={headingRef} />;
  }

  const summaryRows = [
    service && step !== 0
      ? { label: "Serviço", value: <>{service.name} <span className="text-ink-2">({formatDuration(service.durationMinutes)}, {formatCents(service.priceCents)})</span></>, onChange: () => go(0), changeLabel: "Alterar serviço" }
      : null,
    professionalId !== undefined && typeof step === "number" && step > 1
      ? { label: "Profissional", value: professional?.name ?? "Qualquer profissional disponível", onChange: () => go(1), changeLabel: "Alterar profissional" }
      : null,
    slot && step === 3
      ? { label: "Quando", value: `${formatLongDate(slot.startsAt, timezone)}, às ${localTime(slot.startsAt, timezone)}`, onChange: () => go(2), changeLabel: "Alterar dia e horário" }
      : null,
  ].filter((row) => row !== null);

  const professionalItems: ChoiceItem[] = [
    ...(team.length > 1 ? [{ id: ANY, title: "Qualquer profissional disponível", detail: "Mostra os horários de toda a equipe que faz este serviço." }] : []),
    ...team.map((item) => ({ id: item.id, title: item.name })),
  ];

  const current = step as 0 | 1 | 2 | 3;
  const titles = ["Escolha o serviço", "Escolha o profissional", "Escolha o dia e o horário", "Seus dados"] as const;

  return (
    <div className="max-w-[48rem]">
      <StepProgress steps={STEPS} current={current} />
      <div className="mb-6 flex flex-col items-start gap-4">
        {back && (
          <Button variant="ghost" size="sm" onClick={back} className="-ml-3">
            <ArrowLeftIcon /> Voltar
          </Button>
        )}
        <h2 ref={headingRef} tabIndex={-1} className="scroll-mt-36 text-title text-ink outline-none">
          {titles[current]}
        </h2>
      </div>

      {summaryRows.length > 0 && (
        <div className="mb-8">
          <Summary label="Sua escolha" rows={summaryRows} />
        </div>
      )}

      {step === 0 && (
        <ChoiceList
          label="Serviços"
          selectedId={serviceId}
          onChoose={chooseService}
          items={services.map((item) => ({ id: item.id, title: item.name, meta: serviceMeta(item) }))}
        />
      )}

      {step === 1 && service && (
        <ChoiceList
          label="Profissionais"
          selectedId={professionalId === null ? ANY : professionalId}
          onChoose={chooseProfessional}
          items={professionalItems}
        />
      )}

      {step === 2 && service && professionalId !== undefined && (
        <div className="flex flex-col gap-6">
          {slotAlert && <FormAlert message={slotAlert} />}
          <SlotPicker
            slug={business.slug}
            serviceId={service.id}
            professionalId={professionalId}
            timezone={timezone}
            maxWindowDays={business.maxWindowDays}
            value={slot}
            initialDate={pickerDate}
            refreshKey={refreshKey}
            onPick={pickSlot}
          />
        </div>
      )}

      {step === 3 && (
        <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-5">
          {alert && <FormAlert message={alert} />}
          <Field
            name="name"
            label="Nome"
            autoComplete="name"
            value={form.name}
            maxLength={80}
            error={errors.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <Field
            name="phone"
            label="Telefone com DDD"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(11) 98765-4321"
            value={form.phone}
            error={errors.phone}
            hint="O negócio usa para falar com você sobre este horário."
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <Field
            name="email"
            label="E-mail (opcional)"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            error={errors.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <Checkbox name="consent" checked={form.consent} error={errors.consent} onChange={(consent) => setForm({ ...form, consent })}>
            Autorizo {business.name} a guardar meu nome, telefone e e-mail para cuidar deste agendamento, conforme a LGPD.
          </Checkbox>
          <Button type="submit" disabled={pending} className="mt-2 w-full sm:w-auto sm:self-start">
            {pending ? "Confirmando…" : "Confirmar agendamento"}
          </Button>
        </form>
      )}
    </div>
  );
}

function BookingDone({
  business,
  created,
  headingRef,
}: {
  business: BookingBusiness;
  created: BookingCreated;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { appointment, managePath } = created;
  const { timezone } = business;
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const manageUrl = `${origin}${managePath}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(manageUrl);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie.");
    }
  };

  return (
    <div className="max-w-[48rem]">
      <h2 ref={headingRef} tabIndex={-1} className="scroll-mt-28 text-headline text-ink outline-none">
        Agendamento confirmado
      </h2>
      <p className="mt-4 max-w-[60ch] text-lead text-ink-2">
        {appointment.customer.name}, seu horário está reservado. Guarde o link abaixo.
      </p>

      <div className="mt-8">
        <Summary
          label="Seu agendamento"
          rows={[
            { label: "Serviço", value: appointment.service.name },
            { label: "Profissional", value: appointment.professional.name },
            { label: "Quando", value: formatWhen(appointment.startsAt, appointment.endsAt, timezone) },
            { label: "Valor", value: formatCents(appointment.service.priceCents) },
          ]}
        />
      </div>

      <section aria-labelledby="link-gestao" className="mt-8 flex flex-col gap-4">
        <h3 id="link-gestao" className="text-title text-ink">
          Link do seu agendamento
        </h3>
        <Notice title="Guarde este link.">
          É por ele que você vê, cancela ou remarca este horário. Não enviamos o link por e-mail nem por WhatsApp.
          {appointment.canManage && <> Dá para cancelar ou remarcar até {formatDeadline(appointment.manageableUntil, timezone)}.</>}
        </Notice>
        <label htmlFor="link-do-agendamento" className="sr-only">
          Link do agendamento
        </label>
        <input
          id="link-do-agendamento"
          readOnly
          value={manageUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="h-input w-full min-w-0 truncate rounded-control border border-line-strong bg-surface px-3.5 text-small text-ink outline-none focus-visible:border-violet focus-visible:shadow-focus"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={copy} className="w-full sm:w-auto">
            <CopyIcon /> Copiar link
          </Button>
          <Link href={managePath} prefetch={false} className={buttonVariants({ variant: "outline", className: "w-full sm:w-auto" })}>
            Abrir meu agendamento
          </Link>
        </div>
      </section>
    </div>
  );
}
