// QA del motor de asistencia (docs/16, Hito 4 paso 3): asignar horario a varios,
// vista "Por día", filtro por estado, pestaña Asistencia del empleado, "Recalcular"
// y que "Marcaciones" siga igual. Los datos los crea e2e/seed-asistencia.ts — solo
// contra el Postgres de Docker (se niega con cualquier otra base).
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import ExcelJS from "exceljs";
import { closeToastIfAny } from "./helpers";

interface Seed {
  companyId: number;
  companyName: string;
  scheduleName: string;
  from: string;
  to: string;
  ana: { id: number; name: string };
  beto: { id: number; name: string };
}

let seed: Seed;

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
const daysUrl = (extra = "") => `/admin/empresas/${seed.companyId}/asistencia?vista=dias&from=${seed.from}&to=${seed.to}${extra}`;
/** Filas de la tabla de escritorio (la lista móvil está oculta en este viewport). */
const rowsOf = (page: Page, name: string) => page.locator("table tbody tr", { hasText: name });

test.describe.serial("Asistencia por día (motor de asistencia)", () => {
  test.beforeAll(() => {
    const out = execSync("npx tsx --env-file=.env e2e/seed-asistencia.ts", { encoding: "utf8" });
    seed = JSON.parse(out.trim().split("\n").pop()!);
  });

  test("sin horario, Por día avisa que faltan horarios", async ({ page }) => {
    await page.goto(daysUrl());
    await expect(page.getByText(/2 contrato\(s\) vigente\(s\) sin horario/)).toBeVisible();
    await shot(page, "01-sin-horario");
  });

  test("Asignar horario a varios: solo los sin horario, vigente desde el lunes sembrado", async ({ page }) => {
    await page.goto(`/admin/empresas/${seed.companyId}/empleados`);
    await page.getByRole("button", { name: "Asignar horario" }).click();
    const dialog = page.getByRole("dialog");
    // El select (no las casillas, cuya fila también dice "sin horario").
    await expect(dialog.getByRole("combobox", { name: /^Horario/ })).toHaveValue(/\d+/);
    await dialog.getByRole("button", { name: "solo los sin horario (2)" }).click();
    // Por defecto rige desde hoy; se fecha al lunes de la semana sembrada.
    await expect(dialog.getByLabel("Vigente desde")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await dialog.getByLabel("Vigente desde").fill(seed.from);
    await shot(page, "02-dialogo-asignar");
    await dialog.getByRole("button", { name: "Asignar a 2 persona(s)" }).click();
    const [y, m, d] = seed.from.split("-");
    await expect(page.getByText(`Horario asignado a 2 persona(s) desde el ${d}/${m}/${y}`)).toBeVisible({ timeout: 30_000 });
    await shot(page, "03-asignado");
    await closeToastIfAny(page);
  });

  test("Por día: cada estado de la semana con sus minutos", async ({ page }) => {
    await page.goto(daysUrl());
    await expect(page.getByRole("link", { name: "Por día" })).toHaveAttribute("aria-current", "page");
    // Ana: los 5 días presente. Beto: tardanza, ausente, incompleto, salida anticipada, presente.
    await expect(rowsOf(page, seed.ana.name)).toHaveCount(5);
    await expect(rowsOf(page, seed.ana.name).filter({ hasText: "Presente" })).toHaveCount(5);
    const beto = rowsOf(page, seed.beto.name);
    await expect(beto).toHaveCount(5);
    await expect(beto.filter({ hasText: "Tardanza" })).toContainText("25 min tarde");
    await expect(beto.filter({ hasText: "Ausente" })).toHaveCount(1);
    await expect(beto.filter({ hasText: "Incompleto" })).toContainText("una sola marcación");
    await expect(beto.filter({ hasText: "Salida anticipada" })).toContainText("salió 30 min antes");
    await expect(page.getByText(/1 tardanza\b/)).toBeVisible();
    await shot(page, "04-por-dia");
  });

  test("Filtro por estado: solo tardanzas", async ({ page }) => {
    await page.goto(daysUrl("&estado=late"));
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(rowsOf(page, seed.beto.name)).toContainText("Tardanza");
    await shot(page, "05-filtro-tardanza");
  });

  test("De la empresa a la pestaña Asistencia del empleado, y de vuelta", async ({ page }) => {
    await page.goto(daysUrl());
    await rowsOf(page, seed.beto.name).first().getByRole("link", { name: seed.beto.name }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/empleados/${seed.beto.id}/asistencia`));
    await expect(page.getByRole("link", { name: "Asistencia", exact: true })).toHaveAttribute("aria-current", "page");
    // Sin filtro muestra los últimos días cerrados (más que la semana sembrada); el
    // lunes de esa semana es la tardanza de 25 min.
    const [y, m, d] = seed.from.split("-");
    await expect(page.locator("table tbody tr", { hasText: `${d}/${m}/${y}` })).toContainText("25 min tarde");
    // Antes del lunes no tenía horario: el viernes anterior (laborable, sin marcas)
    // no es "Ausente" — no aparece. El horario solo cuenta desde su fecha.
    const fri = new Date(Date.UTC(+y, +m - 1, +d - 3)).toISOString().slice(0, 10).split("-");
    await expect(page.locator("table tbody tr", { hasText: `${fri[2]}/${fri[1]}/${fri[0]}` })).toHaveCount(0);
    await shot(page, "06-empleado-asistencia");
    // El "←" vuelve a la empresa, a la misma vista.
    await page.getByRole("link", { name: `← ${seed.companyName}` }).click();
    await expect(page).toHaveURL(/vista=dias/);
  });

  test("Corregir: agregar la salida que falta, anular y deshacer", async ({ page }) => {
    await page.goto(daysUrl());
    const beto = rowsOf(page, seed.beto.name);
    // Miércoles: una sola marcación (08:00) → agregar la salida.
    await beto.filter({ hasText: "Incompleto" }).getByRole("button", { name: "Corregir marcaciones" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("listitem").filter({ hasText: "08:00" })).toBeVisible();
    // Sin motivo no deja.
    await dialog.getByLabel("Hora").fill("17:00");
    await dialog.getByRole("button", { name: "Agregar marcación" }).click();
    await expect(page.getByText(/Escriba primero el motivo/)).toBeVisible();
    await closeToastIfAny(page);
    await dialog.getByLabel("Motivo (obligatorio)").fill("Olvidó marcar la salida (QA E2E)");
    await dialog.getByRole("button", { name: "Agregar marcación" }).click();
    await expect(page.getByText("Marcación agregada.")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("listitem").filter({ hasText: "Agregada" })).toContainText("Olvidó marcar la salida (QA E2E)");
    await shot(page, "07a-correccion-agregada");
    await closeToastIfAny(page);
    await dialog.getByRole("button", { name: "Cerrar" }).last().click();
    await expect(beto.filter({ hasText: "Incompleto" })).toHaveCount(0);
    await expect(beto.filter({ hasText: "Presente" })).toHaveCount(2);

    // Lunes (tardanza 08:25): anular la entrada → queda "una sola marcación"; deshacer → tardanza otra vez.
    await beto.filter({ hasText: "Tardanza" }).getByRole("button", { name: "Corregir marcaciones" }).click();
    await dialog.getByLabel("Motivo (obligatorio)").fill("Marcación de prueba QA E2E");
    await dialog.getByRole("listitem").filter({ hasText: "08:25" }).getByRole("button", { name: "Anular" }).click();
    await expect(page.getByText("Marcación anulada.")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("heading", { name: "Anuladas" })).toBeVisible();
    await shot(page, "07b-correccion-anulada");
    await closeToastIfAny(page);
    await dialog.getByRole("listitem").filter({ hasText: "08:25" }).getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("La marcación vuelve a contar.")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("heading", { name: "Anuladas" })).toHaveCount(0);
    await closeToastIfAny(page);
    await dialog.getByRole("button", { name: "Cerrar" }).last().click();
    await expect(beto.filter({ hasText: "Tardanza" })).toContainText("25 min tarde");
  });

  test("Recalcular asistencia del período filtrado", async ({ page }) => {
    await page.goto(daysUrl());
    await page.getByRole("button", { name: "Recalcular asistencia del período filtrado" }).click();
    await expect(page.getByText(/Asistencia calculada del/)).toBeVisible({ timeout: 30_000 });
    // La salida agregada a mano sigue contando después de recalcular.
    await expect(rowsOf(page, seed.beto.name).filter({ hasText: "Incompleto" })).toHaveCount(0);
    await shot(page, "07-recalcular");
    await closeToastIfAny(page);
  });

  test("Marcaciones sigue siendo la vista de siempre", async ({ page }) => {
    await page.goto(daysUrl());
    await page.getByRole("link", { name: "Marcaciones" }).click();
    await expect(page.getByRole("columnheader", { name: "Fecha y hora" })).toBeVisible();
    await expect(page.locator("table tbody tr", { hasText: seed.beto.name }).first()).toBeVisible();
    // La marcación agregada sale en la lista (y en el export), marcada como corrección.
    await expect(page.locator("table tbody tr", { hasText: seed.beto.name }).filter({ hasText: "Corrección manual" })).toHaveCount(1);
    await shot(page, "08-marcaciones");
  });

  test("Consolidado del período: totales por persona y su .xlsx", async ({ page }) => {
    await page.goto(daysUrl());
    await page.getByRole("link", { name: "Consolidado" }).click();
    await expect(page).toHaveURL(/vista=consolidado/);
    const beto = rowsOf(page, seed.beto.name);
    // Beto: lun tardanza 25, mar ausente, mié corregido (salida agregada), jue salió 30 antes, vie presente.
    await expect(beto).toContainText("4 de 5");
    await expect(beto).toContainText("1 · 25 min");
    await expect(beto).toContainText("1 · 30 min");
    await expect(rowsOf(page, seed.ana.name)).toContainText("5 de 5");
    await expect(page.locator("table tbody tr", { hasText: "Total" })).toContainText("9 de 10");
    await shot(page, "09-consolidado");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar .xlsx" }).click()]);
    expect(download.suggestedFilename()).toMatch(/ Consolidado \d{8}_\d{8}\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    const ws = wb.getWorksheet("Consolidado")!;
    const rows: unknown[][] = [];
    ws.eachRow((r) => rows.push(r.values as unknown[]));
    const betoRow = rows.find((r) => String(r[2] ?? "").startsWith("Variado E2E"))!;
    // [, cédula, nombre, ref, horario, laborables, trabajados, horas, extra, tardanzas, min, salidas, min, ausencias, …]
    expect([betoRow[5], betoRow[6], betoRow[9], betoRow[10], betoRow[11], betoRow[12], betoRow[13]]).toEqual([5, 4, 1, 25, 1, 30, 1]);
  });

  test("Incidencias del período: con la corrección y filtro por tipo", async ({ page }) => {
    await page.goto(`/admin/empresas/${seed.companyId}/asistencia?vista=incidencias&from=${seed.from}&to=${seed.to}`);
    const beto = rowsOf(page, seed.beto.name);
    await expect(beto.filter({ hasText: "Tardanza" })).toContainText("25 min tarde");
    await expect(beto.filter({ hasText: "Salida anticipada" })).toContainText("salió 30 min antes");
    await expect(beto.filter({ hasText: "Ausencia" })).toHaveCount(1);
    await expect(beto.filter({ hasText: "Marcación agregada a mano" })).toContainText("Olvidó marcar la salida (QA E2E)");
    // La anulación que se deshizo no es una incidencia.
    await expect(beto.filter({ hasText: "Marcación anulada a mano" })).toHaveCount(0);
    await shot(page, "10-incidencias");
    await page.goto(`/admin/empresas/${seed.companyId}/asistencia?vista=incidencias&from=${seed.from}&to=${seed.to}&tipo=absent`);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar .xlsx" }).click()]);
    expect(download.suggestedFilename()).toMatch(/ Incidencias \d{8}_\d{8}\.xlsx$/);
  });
});
