import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  getAnyProfessionalDaySlots,
  getAnyProfessionalWindowSlots,
  getDaySlots,
  getWindowSlots,
  isSlotAvailable,
  type AgendaParams,
  type AvailabilityContext,
  type ProfessionalSchedule,
  type WorkingInterval,
} from "@/server/agenda/availability";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";

// 2026-10-12 é segunda-feira (weekday 1).
const MONDAY = "2026-10-12";

const DEFAULT_PARAMS: AgendaParams = {
  slotStepMinutes: 15,
  bufferMinutes: 0,
  minAdvanceMinutes: 0,
  maxWindowDays: 60,
};

function hm(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function work(weekday: number, start: string, end: string): WorkingInterval {
  return { weekday, startMinute: hm(start), endMinute: hm(end) };
}

// Instante de um horário local "YYYY-MM-DDTHH:MM" no fuso dado.
function at(local: string, zone = SP): Date {
  return DateTime.fromISO(local, { zone }).toJSDate();
}

function ctx(overrides: Partial<Omit<AvailabilityContext, "params">> & { params?: Partial<AgendaParams> } = {}) {
  const { params, ...rest } = overrides;
  return {
    timezone: SP,
    now: at("2026-10-11T08:00"),
    durationMinutes: 60,
    ...rest,
    params: { ...DEFAULT_PARAMS, ...params },
  } satisfies AvailabilityContext;
}

function schedule(overrides: Partial<ProfessionalSchedule> = {}): ProfessionalSchedule {
  return {
    professionalId: "p1",
    workingHours: [work(1, "09:00", "12:00")],
    timeBlocks: [],
    appointments: [],
    ...overrides,
  };
}

// Horários como relógio local, para ler os testes com facilidade.
function local(slots: Date[], zone = SP): string[] {
  return slots.map((slot) => DateTime.fromJSDate(slot, { zone }).toFormat("HH:mm"));
}

function utc(slots: Date[]): string[] {
  return slots.map((slot) => slot.toISOString());
}

function every(start: string, end: string, step: number): string[] {
  const out: string[] = [];
  for (let minute = hm(start); minute <= hm(end); minute += step) {
    out.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return out;
}

describe("getDaySlots: grade, duração e horário de trabalho", () => {
  it("gera a grade de 15 min dentro do expediente, com o serviço cabendo inteiro", () => {
    const slots = getDaySlots(ctx(), schedule(), MONDAY);
    expect(local(slots)).toEqual(every("09:00", "11:00", 15));
    expect(utc(slots)[0]).toBe("2026-10-12T12:00:00.000Z");
  });

  it("duração maior encurta o último horário", () => {
    expect(local(getDaySlots(ctx({ durationMinutes: 90 }), schedule(), MONDAY))).toEqual(
      every("09:00", "10:30", 15),
    );
    expect(local(getDaySlots(ctx({ durationMinutes: 180 }), schedule(), MONDAY))).toEqual(["09:00"]);
    expect(getDaySlots(ctx({ durationMinutes: 181 }), schedule(), MONDAY)).toEqual([]);
  });

  it("o passo da grade muda os inícios", () => {
    expect(local(getDaySlots(ctx({ params: { slotStepMinutes: 30 } }), schedule(), MONDAY))).toEqual(
      every("09:00", "11:00", 30),
    );
    expect(local(getDaySlots(ctx({ params: { slotStepMinutes: 45 } }), schedule(), MONDAY))).toEqual([
      "09:00",
      "09:45",
      "10:30",
    ]);
  });

  it("a grade parte do início de cada intervalo de trabalho do dia", () => {
    const s = schedule({ workingHours: [work(1, "09:00", "10:00"), work(1, "13:10", "14:40")] });
    expect(local(getDaySlots(ctx({ params: { slotStepMinutes: 30 } }), s, MONDAY))).toEqual([
      "09:00",
      "13:10",
      "13:40",
    ]);
  });

  it("intervalos que se encostam no mesmo dia viram um só (o serviço atravessa a emenda)", () => {
    const s = schedule({ workingHours: [work(1, "09:00", "10:00"), work(1, "10:00", "11:00")] });
    expect(local(getDaySlots(ctx(), s, MONDAY))).toEqual(every("09:00", "10:00", 15));
  });

  it("dia sem expediente não tem horários", () => {
    expect(getDaySlots(ctx(), schedule(), "2026-10-13")).toEqual([]);
  });
});

describe("getDaySlots: agendamentos, bloqueios e buffer", () => {
  it("agendamento confirmed ocupa o horário; canceled e completed não", () => {
    const busy = { startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T11:00") };
    const confirmed = schedule({ appointments: [{ ...busy, status: "confirmed" }] });
    expect(local(getDaySlots(ctx(), confirmed, MONDAY))).toEqual([...every("09:00", "09:00", 15), "11:00"]);

    const others = schedule({
      appointments: [
        { ...busy, status: "canceled" },
        { ...busy, status: "completed" },
      ],
    });
    expect(local(getDaySlots(ctx(), others, MONDAY))).toEqual(every("09:00", "11:00", 15));
  });

  it("agendamento existente com serviço curto deixa os encaixes ao redor", () => {
    const s = schedule({
      appointments: [{ startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T10:30"), status: "confirmed" }],
    });
    expect(local(getDaySlots(ctx({ durationMinutes: 30 }), s, MONDAY))).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "10:30",
      "10:45",
      "11:00",
      "11:15",
      "11:30",
    ]);
  });

  it("bloqueio que atravessa o serviço remove todo início cujo serviço o cruzaria", () => {
    const s = schedule({ timeBlocks: [{ startsAt: at("2026-10-12T10:30"), endsAt: at("2026-10-12T10:45") }] });
    // 09:30 termina às 10:30 (encosta, vale); 09:45 até 10:30 cruzam; 10:45 começa quando o bloqueio acaba.
    expect(local(getDaySlots(ctx(), s, MONDAY))).toEqual(["09:00", "09:15", "09:30", "10:45", "11:00"]);
  });

  it("bloqueio que cobre o dia todo, ou vem de outro dia, zera ou corta a agenda", () => {
    const allDay = schedule({ timeBlocks: [{ startsAt: at("2026-10-11T18:00"), endsAt: at("2026-10-12T10:00") }] });
    expect(local(getDaySlots(ctx(), allDay, MONDAY))).toEqual(every("10:00", "11:00", 15));
  });

  it("buffer exige folga antes e depois de cada agendamento", () => {
    const s = schedule({
      appointments: [{ startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T11:00"), status: "confirmed" }],
    });
    const semBuffer = getDaySlots(ctx({ durationMinutes: 30 }), s, MONDAY);
    expect(local(semBuffer)).toEqual(["09:00", "09:15", "09:30", "11:00", "11:15", "11:30"]);

    const comBuffer = getDaySlots(ctx({ durationMinutes: 30, params: { bufferMinutes: 15 } }), s, MONDAY);
    // 09:15 + 30 + 15 = 10:00 (vale); 09:30 colaria no agendamento; depois só a partir de 11:15.
    expect(local(comBuffer)).toEqual(["09:00", "09:15", "11:15", "11:30"]);
  });

  it("buffer não vale para bloqueio nem para o fim do expediente", () => {
    const s = schedule({ timeBlocks: [{ startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T11:00") }] });
    const slots = getDaySlots(ctx({ durationMinutes: 30, params: { bufferMinutes: 30 } }), s, MONDAY);
    expect(local(slots)).toEqual(["09:00", "09:15", "09:30", "11:00", "11:15", "11:30"]);
  });
});

describe("getDaySlots: antecedência mínima e janela máxima", () => {
  it("antecedência mínima corta os horários próximos de agora", () => {
    const now = at("2026-10-12T08:30");
    expect(local(getDaySlots(ctx({ now, params: { minAdvanceMinutes: 120 } }), schedule(), MONDAY))).toEqual(
      every("10:30", "11:00", 15),
    );
    // Exatamente agora + antecedência ainda vale.
    expect(local(getDaySlots(ctx({ now, params: { minAdvanceMinutes: 150 } }), schedule(), MONDAY))).toEqual([
      "11:00",
    ]);
  });

  it("sem antecedência, horários já passados somem e a grade não muda", () => {
    const now = at("2026-10-12T09:07");
    expect(local(getDaySlots(ctx({ now }), schedule(), MONDAY))).toEqual(every("09:15", "11:00", 15));
  });

  it("antecedência que passa do expediente zera o dia", () => {
    const now = at("2026-10-12T08:00");
    expect(getDaySlots(ctx({ now, params: { minAdvanceMinutes: 24 * 60 } }), schedule(), MONDAY)).toEqual([]);
  });

  it("janela máxima: de hoje até hoje + maxWindowDays - 1; o passado não aparece", () => {
    const now = at("2026-10-12T06:00"); // segunda
    const everyDay = schedule({ workingHours: [0, 1, 2, 3, 4, 5, 6].map((d) => work(d, "09:00", "12:00")) });
    const c = ctx({ now, params: { maxWindowDays: 60 } });
    expect(getDaySlots(c, everyDay, "2026-12-10")).toHaveLength(9); // hoje + 59
    expect(getDaySlots(c, everyDay, "2026-12-11")).toEqual([]); // hoje + 60
    expect(getDaySlots(c, everyDay, "2026-10-11")).toEqual([]); // ontem
    expect(getDaySlots(c, everyDay, MONDAY)).toHaveLength(9); // hoje

    const curta = ctx({ now, params: { maxWindowDays: 1 } });
    expect(getDaySlots(curta, everyDay, MONDAY)).toHaveLength(9);
    expect(getDaySlots(curta, everyDay, "2026-10-13")).toEqual([]);
  });

  it("'hoje' é a data no fuso do tenant, não em UTC", () => {
    // 2026-10-13T01:00Z ainda é 12/10 22:00 em São Paulo: hoje continua sendo segunda.
    const now = new Date("2026-10-13T01:00:00Z");
    const s = schedule({ workingHours: [work(1, "09:00", "24:00"), work(2, "09:00", "12:00")] });
    const c = ctx({ now, params: { maxWindowDays: 1 } });
    expect(local(getDaySlots(c, s, MONDAY))).toEqual(every("22:00", "23:00", 15));
    expect(getDaySlots(c, s, "2026-10-13")).toEqual([]);
  });
});

describe("getDaySlots: virada de dia", () => {
  // 2026-10-16 é sexta (5), 2026-10-17 é sábado (6).
  it("expediente até 24:00 sem continuação: o serviço precisa acabar à meia-noite", () => {
    const s = schedule({ workingHours: [work(5, "22:00", "24:00")] });
    expect(local(getDaySlots(ctx(), s, "2026-10-16"))).toEqual(every("22:00", "23:00", 15));
  });

  it("expediente que continua no dia seguinte: o serviço atravessa a meia-noite", () => {
    const s = schedule({ workingHours: [work(5, "22:00", "24:00"), work(6, "00:00", "02:00")] });
    const friday = getDaySlots(ctx(), s, "2026-10-16");
    expect(local(friday)).toEqual(every("22:00", "23:45", 15));
    expect(utc(friday).at(-1)).toBe("2026-10-17T02:45:00.000Z");

    // O sábado só lista os inícios do próprio sábado.
    expect(local(getDaySlots(ctx(), s, "2026-10-17"))).toEqual(every("00:00", "01:00", 15));
  });

  it("agendamento da noite anterior que passa da meia-noite ocupa o começo do dia", () => {
    const s = schedule({
      workingHours: [work(5, "22:00", "24:00"), work(6, "00:00", "02:00")],
      appointments: [{ startsAt: at("2026-10-16T23:30"), endsAt: at("2026-10-17T00:30"), status: "confirmed" }],
    });
    expect(local(getDaySlots(ctx(), s, "2026-10-17"))).toEqual(every("00:30", "01:00", 15));
    expect(local(getDaySlots(ctx(), s, "2026-10-16"))).toEqual(every("22:00", "22:30", 15));
  });
});

describe("getDaySlots: fusos", () => {
  it("fuso diferente de São Paulo: o mesmo relógio local vira outro instante UTC", () => {
    const manaus = getDaySlots(ctx({ timezone: "America/Manaus" }), schedule(), MONDAY);
    expect(utc(manaus)[0]).toBe("2026-10-12T13:00:00.000Z"); // UTC-4
    const tokyo = getDaySlots(ctx({ timezone: "Asia/Tokyo" }), schedule(), MONDAY);
    expect(utc(tokyo)[0]).toBe("2026-10-12T00:00:00.000Z"); // UTC+9
    expect(local(tokyo, "Asia/Tokyo")).toEqual(every("09:00", "11:00", 15));
  });

  it("em Tóquio, 'hoje' já é o dia seguinte ao de UTC", () => {
    const now = new Date("2026-10-12T16:00:00Z"); // 13/10 01:00 em Tóquio
    const c = ctx({ timezone: "Asia/Tokyo", now });
    const s = schedule({ workingHours: [work(1, "09:00", "12:00"), work(2, "09:00", "12:00")] });
    expect(getDaySlots(c, s, MONDAY)).toEqual([]);
    expect(utc(getDaySlots(c, s, "2026-10-13"))[0]).toBe("2026-10-13T00:00:00.000Z");
  });

  it("um agendamento gravado em UTC bloqueia o horário certo no fuso do tenant", () => {
    const s = schedule({
      appointments: [
        { startsAt: new Date("2026-10-12T14:00:00Z"), endsAt: new Date("2026-10-12T15:00:00Z"), status: "confirmed" },
      ],
    });
    // 14:00Z = 10:00 em Manaus.
    expect(local(getDaySlots(ctx({ timezone: "America/Manaus" }), s, MONDAY), "America/Manaus")).toEqual([
      "09:00",
      "11:00",
    ]);
  });
});

describe("getDaySlots: horário de verão", () => {
  const sunday = (start: string, end: string) => schedule({ workingHours: [work(0, start, end)] });
  const hourly = (now: Date) => ctx({ timezone: NY, now, params: { slotStepMinutes: 60 } });

  it("Nova York, início do horário de verão (02:00 pula para 03:00): grade em tempo real", () => {
    const slots = getDaySlots(hourly(new Date("2026-03-01T12:00:00Z")), sunday("00:00", "05:00"), "2026-03-08");
    // O expediente tem 4 horas reais; os inícios ficam a 1 hora real um do outro.
    expect(utc(slots)).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
    ]);
    expect(local(slots, NY)).toEqual(["00:00", "01:00", "03:00", "04:00"]);
  });

  it("Nova York, fim do horário de verão (01:00 se repete): a hora repetida também é oferecida", () => {
    const slots = getDaySlots(hourly(new Date("2026-10-25T12:00:00Z")), sunday("00:00", "03:00"), "2026-11-01");
    expect(utc(slots)).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
    ]);
    expect(local(slots, NY)).toEqual(["00:00", "01:00", "01:00", "02:00"]);
  });

  it("Nova York, fim do horário de verão: agendamento de 1 hora real ocupa só 1 hora real", () => {
    const s = schedule({
      workingHours: [work(0, "00:00", "03:00")],
      // 01:30 EDT (05:30Z) até 01:30 EST (06:30Z).
      appointments: [
        { startsAt: new Date("2026-11-01T05:30:00Z"), endsAt: new Date("2026-11-01T06:30:00Z"), status: "confirmed" },
      ],
    });
    const c = ctx({ timezone: NY, now: new Date("2026-10-25T12:00:00Z"), params: { slotStepMinutes: 30 } });
    expect(utc(getDaySlots(c, s, "2026-11-01"))).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T04:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
      "2026-11-01T07:00:00.000Z",
    ]);
  });

  it("São Paulo em 2018 (meia-noite pulou para 01:00): o dia começa no primeiro instante válido", () => {
    const c = ctx({ timezone: SP, now: new Date("2018-11-01T12:00:00Z"), params: { slotStepMinutes: 60 } });
    const slots = getDaySlots(c, sunday("00:00", "03:00"), "2018-11-04");
    expect(utc(slots)).toEqual(["2018-11-04T03:00:00.000Z", "2018-11-04T04:00:00.000Z"]);
    expect(local(slots)).toEqual(["01:00", "02:00"]);
  });

  it("antecedência mínima conta tempo real atravessando a mudança de horário", () => {
    // 01:30 EST = 06:30Z; antecedência de 30 min libera a partir de 07:00Z (02:00 EST).
    const c = ctx({
      timezone: NY,
      now: new Date("2026-11-01T06:30:00Z"),
      params: { slotStepMinutes: 60, minAdvanceMinutes: 30 },
    });
    expect(utc(getDaySlots(c, sunday("00:00", "03:00"), "2026-11-01"))).toEqual(["2026-11-01T07:00:00.000Z"]);
  });
});

describe("janela de dias", () => {
  it("getWindowSlots devolve cada dia do intervalo, inclusive os vazios", () => {
    const s = schedule({ workingHours: [work(1, "09:00", "10:00"), work(3, "14:00", "15:00")] });
    const window = getWindowSlots(ctx(), s, MONDAY, "2026-10-14");
    expect(window.map((day) => day.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(window.map((day) => local(day.slots))).toEqual([["09:00"], [], ["14:00"]]);
  });

  it("a janela atravessa a mudança de horário sem pular nem repetir datas", () => {
    const s = schedule({ workingHours: [0, 1, 6].map((d) => work(d, "09:00", "10:00")) });
    const c = ctx({ timezone: NY, now: new Date("2026-10-25T12:00:00Z") });
    const window = getWindowSlots(c, s, "2026-10-31", "2026-11-02");
    expect(window.map((day) => day.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(window.map((day) => utc(day.slots))).toEqual([
      ["2026-10-31T13:00:00.000Z"],
      ["2026-11-01T14:00:00.000Z"],
      ["2026-11-02T14:00:00.000Z"],
    ]);
  });

  it("a janela respeita a janela máxima do tenant", () => {
    const now = at("2026-10-12T06:00");
    const window = getWindowSlots(ctx({ now, params: { maxWindowDays: 1 } }), schedule(), MONDAY, "2026-10-19");
    expect(window).toHaveLength(8);
    expect(window.filter((day) => day.slots.length > 0).map((day) => day.date)).toEqual([MONDAY]);
  });
});

describe("qualquer profissional", () => {
  const ana = schedule({ professionalId: "ana", workingHours: [work(1, "09:00", "11:00")] });
  const bia = schedule({
    professionalId: "bia",
    workingHours: [work(1, "10:00", "12:00")],
    appointments: [{ startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T11:00"), status: "confirmed" }],
  });

  it("une os horários e diz quem está livre em cada um, na ordem recebida", () => {
    const slots = getAnyProfessionalDaySlots(ctx({ params: { slotStepMinutes: 30 } }), [ana, bia], MONDAY);
    expect(slots.map((slot) => [local([slot.startsAt])[0], slot.professionalIds])).toEqual([
      ["09:00", ["ana"]],
      ["09:30", ["ana"]],
      ["10:00", ["ana"]],
      ["11:00", ["bia"]],
    ]);
  });

  it("horário em que os dois estão livres lista os dois", () => {
    const livre = schedule({ ...bia, appointments: [] });
    const slots = getAnyProfessionalDaySlots(ctx({ params: { slotStepMinutes: 30 } }), [livre, ana], MONDAY);
    expect(slots.find((slot) => local([slot.startsAt])[0] === "10:00")?.professionalIds).toEqual(["bia", "ana"]);
  });

  it("une grades desalinhadas em ordem de horário", () => {
    const carla = schedule({ professionalId: "carla", workingHours: [work(1, "09:10", "10:10")] });
    const slots = getAnyProfessionalDaySlots(ctx({ params: { slotStepMinutes: 60 } }), [ana, carla], MONDAY);
    expect(slots.map((slot) => local([slot.startsAt])[0])).toEqual(["09:00", "09:10", "10:00"]);
  });

  it("sem profissionais, ou todos ocupados, não há horários", () => {
    expect(getAnyProfessionalDaySlots(ctx(), [], MONDAY)).toEqual([]);
    expect(getAnyProfessionalDaySlots(ctx(), [ana, bia], "2026-10-13")).toEqual([]);
  });

  it("janela no modo qualquer profissional", () => {
    const window = getAnyProfessionalWindowSlots(ctx({ params: { slotStepMinutes: 60 } }), [ana, bia], MONDAY, "2026-10-13");
    expect(window.map((day) => [day.date, day.slots.length])).toEqual([
      ["2026-10-12", 3],
      ["2026-10-13", 0],
    ]);
  });
});

describe("isSlotAvailable", () => {
  it("aceita um horário da grade livre e recusa fora da grade, ocupado ou fora das regras", () => {
    const s = schedule({
      appointments: [{ startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T11:00"), status: "confirmed" }],
    });
    expect(isSlotAvailable(ctx(), s, at("2026-10-12T09:00"))).toBe(true);
    expect(isSlotAvailable(ctx(), s, at("2026-10-12T11:00"))).toBe(true);
    expect(isSlotAvailable(ctx(), s, at("2026-10-12T09:05"))).toBe(false); // fora da grade
    expect(isSlotAvailable(ctx(), s, at("2026-10-12T09:30"))).toBe(false); // cruza o agendamento
    expect(isSlotAvailable(ctx(), s, at("2026-10-12T08:00"))).toBe(false); // fora do expediente
    expect(isSlotAvailable(ctx({ now: at("2026-10-12T10:00") }), s, at("2026-10-12T09:00"))).toBe(false); // passado
  });

  it("aceita um início que atravessa a meia-noite, conferido no dia do início", () => {
    const s = schedule({ workingHours: [work(5, "22:00", "24:00"), work(6, "00:00", "02:00")] });
    expect(isSlotAvailable(ctx(), s, at("2026-10-16T23:45"))).toBe(true);
    expect(isSlotAvailable(ctx(), s, at("2026-10-17T01:15"))).toBe(false);
  });
});

describe("entradas inválidas", () => {
  it("recusa data, fuso, duração e parâmetros inválidos", () => {
    expect(() => getDaySlots(ctx(), schedule(), "12/10/2026")).toThrow(RangeError);
    expect(() => getDaySlots(ctx(), schedule(), "2026-02-30")).toThrow(RangeError);
    expect(() => getDaySlots(ctx({ timezone: "Marte/Olympus" }), schedule(), MONDAY)).toThrow(RangeError);
    expect(() => getDaySlots(ctx({ durationMinutes: 0 }), schedule(), MONDAY)).toThrow(RangeError);
    expect(() => getDaySlots(ctx({ params: { slotStepMinutes: 0 } }), schedule(), MONDAY)).toThrow(RangeError);
    expect(() => getDaySlots(ctx({ params: { bufferMinutes: -5 } }), schedule(), MONDAY)).toThrow(RangeError);
  });

  it("não altera as entradas", () => {
    const s = schedule({
      workingHours: [work(1, "09:00", "10:00"), work(1, "10:00", "11:00")],
      appointments: [{ startsAt: at("2026-10-12T10:00"), endsAt: at("2026-10-12T10:30"), status: "confirmed" }],
    });
    const before = JSON.stringify(s);
    getDaySlots(ctx({ params: { bufferMinutes: 15 } }), s, MONDAY);
    expect(JSON.stringify(s)).toBe(before);
  });
});
