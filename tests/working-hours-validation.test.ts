import { describe, expect, it } from "vitest";
import {
  timeOfDaySchema,
  weeklyScheduleSchema,
  workingHoursIntervalSchema,
} from "@/server/validation/working-hours";

describe("timeOfDaySchema", () => {
  it.each([
    ["00:00", 0],
    ["08:30", 510],
    ["23:59", 1439],
    ["24:00", 1440],
  ])("%s vira %i minutos", (value, minutes) => {
    expect(timeOfDaySchema.parse(value)).toBe(minutes);
  });

  it.each(["8:00", "24:01", "25:00", "12:60", "12h00", "", "12:00:00"])("rejeita %j", (value) => {
    expect(timeOfDaySchema.safeParse(value).success).toBe(false);
  });
});

describe("workingHoursIntervalSchema", () => {
  it("converte para minutos", () => {
    expect(workingHoursIntervalSchema.parse({ weekday: 1, start: "09:00", end: "18:00" })).toEqual({
      weekday: 1,
      startMinute: 540,
      endMinute: 1080,
    });
  });

  it("aceita até 24:00 no fim", () => {
    expect(workingHoursIntervalSchema.safeParse({ weekday: 6, start: "18:00", end: "24:00" }).success).toBe(true);
  });

  it.each([
    [{ weekday: 1, start: "10:00", end: "10:00" }, "fim igual ao início"],
    [{ weekday: 1, start: "10:00", end: "09:00" }, "fim antes do início"],
    [{ weekday: 1, start: "24:00", end: "24:00" }, "início 24:00"],
    [{ weekday: 7, start: "09:00", end: "10:00" }, "dia 7"],
    [{ weekday: -1, start: "09:00", end: "10:00" }, "dia negativo"],
    [{ weekday: 1.5, start: "09:00", end: "10:00" }, "dia fracionado"],
    [{ weekday: 1, start: "09:00" }, "sem fim"],
  ] as [unknown, string][])("rejeita %j (%s)", (input) => {
    expect(workingHoursIntervalSchema.safeParse(input).success).toBe(false);
  });
});

describe("weeklyScheduleSchema", () => {
  it("aceita vários intervalos no dia, encostados ou não, e o mesmo horário em dias diferentes", () => {
    const result = weeklyScheduleSchema.safeParse([
      { weekday: 1, start: "08:00", end: "12:00" },
      { weekday: 1, start: "12:00", end: "14:00" },
      { weekday: 1, start: "15:00", end: "19:00" },
      { weekday: 2, start: "08:00", end: "12:00" },
    ]);
    expect(result.success).toBe(true);
  });

  it("aceita grade vazia", () => {
    expect(weeklyScheduleSchema.safeParse([]).success).toBe(true);
  });

  it.each([
    [[{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:59", end: "13:00" }], "parcial"],
    [[{ weekday: 1, start: "08:00", end: "18:00" }, { weekday: 1, start: "10:00", end: "11:00" }], "contido"],
    [[{ weekday: 4, start: "08:00", end: "12:00" }, { weekday: 4, start: "08:00", end: "12:00" }], "idêntico"],
  ])("rejeita sobreposição (%#: %s)", (intervals) => {
    const result = weeklyScheduleSchema.safeParse(intervals);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Há intervalos sobrepostos no mesmo dia");
  });
});
