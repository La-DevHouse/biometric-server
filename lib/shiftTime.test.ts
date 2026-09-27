import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeShiftTimes, maskTime, normalizeTime, parseTime, formatMinutes } from "./shiftTime";

test("shiftTime - lo que se escribe a mano se normaliza a HH:MM", () => {
  for (const [raw, out] of [
    ["7:00", "07:00"],
    ["07:00", "07:00"],
    ["7", "07:00"],
    ["700", "07:00"],
    ["0700", "07:00"],
    ["7.30", "07:30"],
    ["7h30", "07:30"],
    ["1330", "13:30"],
    ["23:59", "23:59"],
  ]) assert.equal(normalizeTime(raw), out, raw);
  assert.equal(normalizeTime("24:00"), "24:00", "inválida: se deja para que la validación la marque");
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("7:60"), null);
  assert.equal(parseTime("7:00"), 420);
});

test("shiftTime - máscara mientras se escribe (tecla por tecla)", () => {
  // Simula tipear carácter por carácter, pasando cada vez por la máscara.
  const type = (keys: string) => [...keys].reduce((v, k) => maskTime(v + k), "");
  assert.equal(type("1500"), "15:00", "el caso que fallaba: terminaba en 1:50");
  assert.equal(type("700"), "7:00");
  assert.equal(type("7:00"), "7:00");
  assert.equal(type("0700"), "07:00");
  assert.equal(type("1:30"), "1:30", "':' a mano después de un dígito 0–2");
  assert.equal(type("2359"), "23:59");
  assert.equal(type("73099"), "7:30", "no pasa de HH:MM");
  assert.equal(type("a7b"), "7");
  // Borrar: de "15:00" a "15:0" y a "15" (el ":" se va solo).
  assert.equal(maskTime("15:0"), "15:0");
  assert.equal(maskTime("15:"), "15");
});

test("shiftTime - horas de jornada y medianoche", () => {
  const day = computeShiftTimes({ start: "06:30", end: "13:30", breakStart: "12:00", breakEnd: "13:00" });
  assert.deepEqual(day, { ok: true, crossesMidnight: false, workedMinutes: 360, hours: "6.00" });

  const night = computeShiftTimes({ start: "22:00", end: "06:00", breakStart: "02:00", breakEnd: "02:30" });
  assert.deepEqual(night, { ok: true, crossesMidnight: true, workedMinutes: 450, hours: "7.50" });

  const noBreak = computeShiftTimes({ start: "7:00", end: "15:00" });
  assert.ok(noBreak.ok && noBreak.workedMinutes === 480 && !noBreak.crossesMidnight);
  assert.equal(formatMinutes(450), "7 h 30 min");
  assert.equal(formatMinutes(480), "8 h");
});

test("shiftTime - errores por campo", () => {
  const e = (i: Parameters<typeof computeShiftTimes>[0]) => {
    const r = computeShiftTimes(i);
    return r.ok ? null : r.field;
  };
  assert.equal(e({ start: "", end: "13:00" }), "start");
  assert.equal(e({ start: "07:00", end: "25:00" }), "end");
  assert.equal(e({ start: "07:00", end: "07:00" }), "end");
  assert.equal(e({ start: "07:00", end: "15:00", breakStart: "12:00" }), "breakEnd", "descanso incompleto");
  assert.equal(e({ start: "07:00", end: "15:00", breakStart: "16:00", breakEnd: "16:30" }), "breakStart", "fuera del turno");
  assert.equal(e({ start: "07:00", end: "15:00", breakStart: "13:00", breakEnd: "12:00" }), "breakEnd", "fin antes que inicio");
  assert.equal(e({ start: "22:00", end: "06:00", breakStart: "07:00", breakEnd: "08:00" }), "breakStart", "fuera del turno nocturno");
});
