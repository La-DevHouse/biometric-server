import { test } from "node:test";
import { strict as assert } from "node:assert";
import { clockDriftMs } from "./deviceClock";

test("clockDriftMs - desvío del reloj del equipo en hora de pared de la sede", () => {
  // 12:00:00 en Caracas (UTC-4) = 16:00:00 UTC
  const now = Date.parse("2026-09-27T16:00:00Z");
  assert.equal(clockDriftMs("20260927120000", "America/Caracas", now), 0);
  assert.equal(clockDriftMs("20260927120130", "America/Caracas", now), 90_000, "1:30 adelantado");
  assert.equal(clockDriftMs("260927115900", "America/Caracas", now), -60_000, "formato de 12 dígitos");
  assert.ok((clockDriftMs("20150101005259", "America/Caracas", now) ?? 0) < -300 * 864e5, "el equipo en 2015");
  // La misma hora de pared en otra zona NO es desvío si la sede está en esa zona.
  assert.equal(clockDriftMs("20260927110000", "America/Bogota", now), 0);
  assert.equal(clockDriftMs("", "America/Caracas", now), null);
  assert.equal(clockDriftMs("basura", "America/Caracas", now), null);
});
