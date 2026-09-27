import { test } from "node:test";
import { strict as assert } from "node:assert";
import { formatRelativeTime } from "./formatRelativeTime";

test("formatRelativeTime - estándar: justo ahora / min / h / días", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const ago = (s: number) => formatRelativeTime(now - s * 1000, now);
  assert.equal(ago(0), "justo ahora");
  assert.equal(ago(59), "justo ahora");
  assert.equal(ago(60), "hace 1 min");
  assert.equal(ago(59 * 60 + 59), "hace 59 min", "trunca, no redondea a 60");
  assert.equal(ago(3600), "hace 1 h");
  assert.equal(ago(23 * 3600 + 3599), "hace 23 h");
  assert.equal(ago(24 * 3600), "hace 1 día");
  assert.equal(ago(5 * 24 * 3600), "hace 5 días");
  assert.equal(formatRelativeTime(null, now), "nunca");
  assert.equal(formatRelativeTime(now + 5000, now), "justo ahora", "reloj del cliente atrasado: nunca negativo");
});
