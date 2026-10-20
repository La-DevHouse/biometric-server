// QA contra PRODUCCIÓN, solo en la empresa "COLEGIO PRUEBA" (autorizado por el
// usuario el 2026-10-19). Siembra con e2e/seed-prod-colegio.ts (marcaciones de una
// semana pasada para dos personas que ya existen, sin tocar los equipos físicos) y
// recorre lo nuevo: horario con "Vigente desde", Por día, atajos de período, Agregar
// asistencia, Corregir, Consolidado / Incidencias (.xlsx), export Galepso, la ficha
// del empleado, y un Socio limitado a la empresa.
//
// Se corre solo a propósito:
//   E2E_PROD=1 E2E_PROD_COMPANY="COLEGIO PRUEBA" E2E_PASSWORD=<aleatoria> \
//   E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/prod-colegio.spec.ts
// y al final: npx tsx --env-file=.env e2e/prod-teardown.ts (desactiva las cuentas e2e-…).
import { test, expect, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import ExcelJS from "exceljs";
import { closeToastIfAny } from "./helpers";

interface Person {
  id: number;
  employmentId: number;
  name: string;
  cedula: string;
}
interface Seed {
  companyId: number;
  companyName: string;
  devId: string;
  deviceName: string;
  scheduleName: string;
  from: string;
  to: string;
  ana: Person;
  beto: Person;
}

test.skip(!process.env.E2E_PROD, "Solo contra producción, a propósito (E2E_PROD=1).");

let S: Seed;
const STAMP = Date.now().toString(36);
const partner = { name: `E2E Socio Colegio ${STAMP}`, email: `e2e-socio-colegio-${STAMP}@grupoalco.test` };
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
const daysUrl = (extra = "") => `/admin/empresas/${S.companyId}/asistencia?vista=dias&from=${S.from}&to=${S.to}${extra}`;
const rowsOf = (page: Page, name: string) => page.locator("table tbody tr", { hasText: name });
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const dayOf = (i: number) => {
  const [y, m, d] = S.from.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function loginAs(browser: Browser, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/\/admin$/, { timeout: 15_000 }).catch(() => page.goto("/admin"));
  await expect(page).toHaveURL(/\/admin$/);
  return page;
}

test.describe.serial("Producción — COLEGIO PRUEBA", () => {
  test.beforeAll(() => {
    const out = execSync("npx tsx --env-file=.env e2e/seed-prod-colegio.ts", { encoding: "utf8", env: { ...process.env } });
    S = JSON.parse(out.trim().split("\n").pop()!);
    console.log(`[prod] semana ${S.from}…${S.to} · ${S.ana.name} y ${S.beto.name} · equipo ${S.deviceName}`);
  });

  test("Asignar horario a las dos personas, vigente desde el lunes sembrado", async ({ page }) => {
    await page.goto(`/admin/empresas/${S.companyId}/empleados`);
    await page.getByRole("button", { name: "Asignar horario" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: /^Horario/ }).selectOption({ label: S.scheduleName });
    await dialog.getByLabel("Vigente desde").fill(S.from);
    for (const p of [S.ana, S.beto]) await dialog.getByRole("checkbox", { name: new RegExp(esc(p.name)) }).check();
    await shot(page, "01-asignar-horario");
    await dialog.getByRole("button", { name: "Asignar a 2 persona(s)" }).click();
    await expect(page.getByText(`Horario asignado a 2 persona(s) desde el ${dmy(S.from)}`)).toBeVisible({ timeout: 60_000 });
    await closeToastIfAny(page);
  });

  test("Por día: cada estado de la semana", async ({ page }) => {
    await page.goto(daysUrl());
    const ana = rowsOf(page, S.ana.name);
    const beto = rowsOf(page, S.beto.name);
    await expect(ana.filter({ hasText: "Presente" })).toHaveCount(5);
    await expect(beto.filter({ hasText: "Tardanza" })).toContainText("25 min tarde");
    await expect(beto.filter({ hasText: "Ausente" })).toHaveCount(1);
    await expect(beto.filter({ hasText: "Incompleto" })).toContainText("una sola marcación");
    await expect(beto.filter({ hasText: "Salida anticipada" })).toContainText("salió 30 min antes");
    await shot(page, "02-por-dia");
  });

  test("Atajos de período en Marcaciones, Por día y Consolidado", async ({ page }) => {
    for (const [url, keep] of [
      [`/admin/empresas/${S.companyId}/asistencia`, /asistencia\?from=/],
      [daysUrl("&estado=late"), /vista=dias&estado=late/],
      [`/admin/empresas/${S.companyId}/asistencia?vista=consolidado`, /vista=consolidado/],
    ] as const) {
      await page.goto(url);
      await page.getByRole("link", { name: "Quincena anterior" }).click();
      await expect(page).toHaveURL(keep);
      await expect(page.getByRole("link", { name: "Quincena anterior" })).toHaveAttribute("aria-current", "true");
    }
  });

  test("Agregar asistencia: el martes sin marcas pasa a Presente", async ({ page }) => {
    await page.goto(daysUrl());
    const tue = rowsOf(page, S.beto.name).filter({ hasText: dmy(dayOf(1)) });
    await expect(tue).toContainText("Ausente");
    await page.getByRole("button", { name: "Agregar asistencia" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Persona *").selectOption({ label: S.beto.name });
    await dialog.getByLabel("Fecha *").fill(dayOf(1));
    await dialog.getByLabel("Entrada *").fill("08:00");
    await dialog.getByLabel("Salida", { exact: true }).fill("17:00");
    // Sin motivo no deja.
    await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.getByText(/Escriba el motivo/)).toBeVisible();
    await closeToastIfAny(page);
    await dialog.getByLabel("Motivo *").fill("Olvidó marcar entrada y salida (QA E2E)");
    await shot(page, "03-agregar-asistencia");
    await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.getByText("Asistencia agregada (entrada y salida).")).toBeVisible({ timeout: 60_000 });
    await closeToastIfAny(page);
    await expect(tue).toContainText("Presente");
    await expect(tue).toContainText("08:00");
  });

  test("Corregir: agregar la salida del miércoles, anular y deshacer la entrada del lunes", async ({ page }) => {
    await page.goto(daysUrl());
    const beto = rowsOf(page, S.beto.name);
    await beto.filter({ hasText: "Incompleto" }).getByRole("button", { name: "Corregir marcaciones" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motivo (obligatorio)").fill("Olvidó marcar la salida (QA E2E)");
    await dialog.getByLabel("Hora").fill("17:00");
    await dialog.getByRole("button", { name: "Agregar marcación" }).click();
    await expect(page.getByText("Marcación agregada.")).toBeVisible({ timeout: 60_000 });
    await closeToastIfAny(page);
    await dialog.getByRole("button", { name: "Cerrar" }).last().click();
    await expect(beto.filter({ hasText: "Incompleto" })).toHaveCount(0);

    await beto.filter({ hasText: "Tardanza" }).getByRole("button", { name: "Corregir marcaciones" }).click();
    await dialog.getByLabel("Motivo (obligatorio)").fill("Prueba de anulación (QA E2E)");
    await dialog.getByRole("listitem").filter({ hasText: "08:25" }).getByRole("button", { name: "Anular" }).click();
    await expect(page.getByText("Marcación anulada.")).toBeVisible({ timeout: 60_000 });
    await closeToastIfAny(page);
    await dialog.getByRole("listitem").filter({ hasText: "08:25" }).getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("La marcación vuelve a contar.")).toBeVisible({ timeout: 60_000 });
    await closeToastIfAny(page);
    await dialog.getByRole("button", { name: "Cerrar" }).last().click();
    await expect(beto.filter({ hasText: "Tardanza" })).toContainText("25 min tarde");
    await shot(page, "04-corregido");
  });

  test("Consolidado e Incidencias, con sus .xlsx", async ({ page }) => {
    await page.goto(`/admin/empresas/${S.companyId}/asistencia?vista=consolidado&from=${S.from}&to=${S.to}`);
    const beto = rowsOf(page, S.beto.name);
    // lun tardanza 25, mar agregado, mié corregido, jue salida 30 antes, vie bien.
    await expect(beto).toContainText("5 de 5");
    await expect(beto).toContainText("1 · 25 min");
    await expect(beto).toContainText("1 · 30 min");
    await expect(rowsOf(page, S.ana.name)).toContainText("5 de 5");
    await shot(page, "05-consolidado");
    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar .xlsx" }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await xlsx.path());
    const rows: unknown[][] = [];
    wb.getWorksheet("Consolidado")!.eachRow((r) => rows.push(r.values as unknown[]));
    const b = rows.find((r) => r[1] === S.beto.cedula)!;
    expect([b[5], b[6], b[9], b[10], b[11], b[12], b[13], b[16]]).toEqual([5, 5, 1, 25, 1, 30, 0, 3]);

    await page.goto(`/admin/empresas/${S.companyId}/asistencia?vista=incidencias&from=${S.from}&to=${S.to}`);
    const inc = rowsOf(page, S.beto.name);
    await expect(inc.filter({ hasText: "Tardanza" })).toContainText("25 min tarde");
    await expect(inc.filter({ hasText: "Marcación agregada a mano" })).toHaveCount(3);
    await expect(inc.filter({ hasText: "Ausencia" })).toHaveCount(0);
    await shot(page, "06-incidencias");
  });

  test("Export a nómina (Galepso): incluye las marcaciones agregadas a mano", async ({ page }) => {
    await page.goto(`/admin/empresas/${S.companyId}/asistencia?from=${S.from}&to=${S.to}`);
    const downloading = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Exportar a Excel (Galepso)" }).click();
    // Si hay IDs de equipo sin empleado en el rango aparece el aviso: se exporta sin asignarlas.
    const without = page.getByRole("button", { name: "Exportar sin incluirlas" });
    if (await without.isVisible({ timeout: 5_000 }).catch(() => false)) await without.click();
    const file = await downloading;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await file.path());
    const ws = wb.worksheets[0];
    const beto: string[] = [];
    ws.eachRow((r) => {
      if (r.getCell(1).value === S.beto.cedula) beto.push(String(r.getCell(3).value));
    });
    // lun 2 + mar 2 (agregadas) + mié 2 (1 + agregada) + jue 2 + vie 2 = 10.
    expect(beto).toHaveLength(10);
  });

  test("Empleado → Asistencia: la semana y el botón Agregar asistencia", async ({ page }) => {
    await page.goto(`/admin/empleados/${S.beto.id}/asistencia?from=${S.from}&to=${S.to}`);
    await expect(page.locator("table tbody tr")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Agregar asistencia" })).toBeVisible();
    await shot(page, "07-empleado");
  });

  test("Socio de COLEGIO PRUEBA: solo ve su empresa y puede agregar asistencia", async ({ page, browser }) => {
    const password = process.env.E2E_PASSWORD!;
    await page.goto("/admin/cuentas");
    await page.getByRole("button", { name: "Nueva cuenta" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre *").fill(partner.name);
    await dialog.getByLabel("Email *").fill(partner.email);
    await dialog.getByLabel("Contraseña inicial *").fill(password);
    await dialog.getByLabel("Perfil *").selectOption("operator");
    await dialog.getByLabel("Buscar empresa").fill(S.companyName);
    await dialog.getByRole("checkbox", { name: S.companyName, exact: true }).check();
    await dialog.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText(`Cuenta de ${partner.name} creada.`)).toBeVisible();
    await closeToastIfAny(page);

    const p = await loginAs(browser, partner.email, password);
    await p.goto("/admin/empresas");
    await expect(p.getByText(/^1 empresa/)).toBeVisible();
    await expect(p.getByRole("link", { name: S.companyName }).first()).toBeVisible();
    await p.goto(daysUrl());
    await expect(p.getByRole("button", { name: "Agregar asistencia" })).toBeVisible();
    await expect(rowsOf(p, S.beto.name).first()).toBeVisible();
    // Huellas: no puede borrar usuarios del equipo.
    await p.goto(`/admin/dispositivos/${encodeURIComponent(S.devId)}/usuarios`);
    await expect(p.getByRole("button", { name: /Eliminar usuario/ })).toHaveCount(0);
    await shot(p, "08-socio");
    await p.context().close();
  });
});
