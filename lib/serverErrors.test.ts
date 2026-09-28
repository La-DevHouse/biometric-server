import { test } from "node:test";
import { strict as assert } from "node:assert";
import { Prisma } from "@prisma/client";
import { userErrorMessage } from "./serverErrors";

const quiet = <T>(fn: () => T): T => {
  const orig = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = orig;
  }
};

test("userErrorMessage - los errores propios pasan igual", () => {
  assert.equal(userErrorMessage(new Error("El RIF es obligatorio.")), "El RIF es obligatorio.");
});

test("userErrorMessage - un trigger de Postgres (vía Prisma) muestra su texto, no el volcado", () => {
  const e = new Prisma.PrismaClientUnknownRequestError(
    'Invalid `prisma.client_company.create()` invocation…\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "la empresa 60 debe tener al menos una sede activa", severity: "ERROR" }) })',
    { clientVersion: "x" }
  );
  assert.equal(quiet(() => userErrorMessage(e)), "La empresa 60 debe tener al menos una sede activa.");
});

test("userErrorMessage - validación de Prisma (un bug nuestro): mensaje genérico, nunca el volcado", () => {
  const e = new Prisma.PrismaClientValidationError("Invalid `prisma.x.create()` invocation … Unknown argument `group_id`", { clientVersion: "x" });
  const msg = quiet(() => userErrorMessage(e));
  assert.doesNotMatch(msg, /Unknown argument|invocation/);
  assert.match(msg, /error interno/);
});

test("userErrorMessage - duplicado (P2002)", () => {
  const e = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
  assert.match(quiet(() => userErrorMessage(e)), /Ya existe/);
});
