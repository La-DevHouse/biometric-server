// Recorrido general del panel (QA completo): lo que las otras pruebas no tocan —
// Inicio, buscador global, equipo (información, usuarios, marcaciones), horarios y
// turnos, contratos (alta y baja) y equipos de una persona, export a nómina, y las
// pantallas nuevas en el celular. Siembra con e2e/seed-asistencia.ts (solo Docker).
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { closeToastIfAny } from "./helpers";

interface Seed {
  companyId: number;
  companyName: string;
  from: string;
  to: string;
  ana: { id: number; name: string };
  beto: { id: number; name: string };
}

let S: Seed;
let other: Seed;
const stampOf = (s: Seed) => s.companyName.replace("E2E Asistencia ", "");
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
const seed = (): Seed => JSON.parse(execSync("npx tsx --env-file=.env e2e/seed-asistencia.ts", { encoding: "utf8" }).trim().split("\n").pop()!);

test.describe.serial("Recorrido general", () => {
  test.beforeAll(() => {
    S = seed();
    other = seed();
  });

  test("Inicio: ayer, atención, empresas y últimas marcaciones", async ({ page }) => {
    await page.goto("/admin");
    for (const k of ["Equipos en línea", "Marcaciones hoy", "Personas con contrato"])
      await expect(page.getByText(k, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Ayer|Último día laborable), / })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Empresas — / })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Últimas marcaciones" })).toBeVisible();
    // Cada empresa de la tabla lleva a su "Por día" de ayer (en Docker hay muchas
    // empresas E2E de corridas anteriores: se muestran las 15 con más incidencias).
    const first = page.locator("table").first().locator("tbody tr a").first();
    await expect(first).toHaveAttribute("href", /\/asistencia\?vista=dias&from=\d{4}-\d{2}-\d{2}&to=/);
    await shot(page, "01-inicio");
  });

  test("Buscador global (Ctrl K): encuentra la empresa y abre su ficha", async ({ page }) => {
    await page.goto("/admin");
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox");
    await box.fill(stampOf(S));
    const option = page.getByRole("option", { name: new RegExp(S.companyName) }).first();
    await expect(option).toBeVisible();
    await shot(page, "02-buscador");
    await option.click();
    await expect(page).toHaveURL(new RegExp(`/admin/empresas/${S.companyId}$`));
  });

  test("Equipo: información, usuarios y marcaciones", async ({ page }) => {
    const dev = `E2E${stampOf(S)}`;
    await page.goto("/admin/dispositivos");
    await page.getByRole("link", { name: `Equipo E2E ${stampOf(S)}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/dispositivos/${dev}$`));
    await expect(page.getByRole("heading", { name: `Equipo E2E ${stampOf(S)}` })).toBeVisible();
    await shot(page, "03-equipo-info");
    const tabs = page.getByRole("navigation", { name: "Secciones del equipo" });
    await tabs.getByRole("link", { name: "Usuarios" }).click();
    await expect(page).toHaveURL(/\/usuarios$/);
    await tabs.getByRole("link", { name: "Marcaciones" }).click();
    await expect(page).toHaveURL(/\/marcaciones/);
    // La semana sembrada: marcaciones de las dos personas.
    await page.goto(`/admin/dispositivos/${dev}/marcaciones?from=${S.from}&to=${S.to}`);
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await shot(page, "04-equipo-marcaciones");
  });

  test("Horarios: crear un horario y su turno", async ({ page }) => {
    const name = `E2E Tarde ${stampOf(S)}`;
    await page.goto("/admin/horarios");
    await page.getByRole("button", { name: "Nuevo horario" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Empresa *").selectOption(String(S.companyId));
    await dialog.getByLabel("Nombre *").fill(name);
    await dialog.getByRole("button", { name: "Crear horario" }).click();
    await expect(page.getByText(`Horario "${name}" creado.`)).toBeVisible();
    await closeToastIfAny(page);

    await page.getByRole("link", { name }).first().click();
    await page.getByRole("button", { name: "Nuevo turno" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre *").fill("13 a 21");
    await dialog.getByLabel("Hora inicio *").fill("1300");
    await dialog.getByLabel("Hora fin *").fill("2100");
    await expect(dialog.getByText("8 h")).toBeVisible();
    await dialog.getByLabel("Vigencia desde *").fill(S.from);
    await dialog.getByRole("button", { name: "Crear turno" }).click();
    await expect(page.getByText(`Turno "13 a 21" creado.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(page.locator("table tbody tr", { hasText: "13 a 21" }).first()).toBeVisible();
    await shot(page, "05-horario");
  });

  test("Contratos: alta en otra empresa y baja", async ({ page }) => {
    await page.goto(`/admin/empleados/${S.ana.id}/contratos`);
    await page.getByRole("button", { name: "Nuevo contrato" }).click();
    const dialog = page.getByRole("dialog");
    const company = dialog.getByRole("combobox", { name: "Empresa" });
    await company.fill(stampOf(other));
    await page.getByRole("option", { name: new RegExp(other.companyName) }).click();
    await dialog.locator('input[name="start_date"]').fill(other.from);
    await dialog.getByRole("button", { name: "Registrar contrato" }).click();
    await expect(page.getByText(/^Contrato registrado\./)).toBeVisible({ timeout: 30_000 });
    await closeToastIfAny(page);
    await expect(page.locator("table tbody tr", { hasText: other.companyName })).toContainText("Vigente");
    await shot(page, "06-contratos");

    await page.getByRole("button", { name: `Dar de baja en ${other.companyName}` }).click();
    await page.getByRole("dialog").getByLabel("Fecha de baja *").fill(other.to);
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar baja" }).click();
    await expect(page.getByText(/^Baja registrada\./)).toBeVisible({ timeout: 30_000 });
    await closeToastIfAny(page);
    await expect(page.locator("table tbody tr", { hasText: other.companyName })).toContainText("Cerrado");

    // Equipos de la persona: el de su empresa.
    await page.getByRole("navigation", { name: "Secciones del empleado" }).getByRole("link", { name: /Equipos/ }).click();
    await expect(page.getByText(`Equipo E2E ${stampOf(S)}`).first()).toBeVisible();
  });

  test("Export a nómina (Galepso): descarga el .xlsx de la semana", async ({ page }) => {
    await page.goto(`/admin/empresas/${S.companyId}/asistencia?from=${S.from}&to=${S.to}`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar a Excel (Galepso)" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/Relación de Asistencia .*\.xlsx$/);
  });

  test("Atajos de período en Marcaciones y Por día: cambian el rango y conservan la vista", async ({ page }) => {
    const base = `/admin/empresas/${S.companyId}/asistencia`;
    for (const [url, keep] of [
      [`${base}?sede=0`, /sede=0/],
      [`${base}?vista=dias&estado=late`, /vista=dias.*estado=late|estado=late.*vista=dias/],
    ] as const) {
      await page.goto(url);
      const link = page.getByRole("link", { name: "Mes anterior" });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);
      await expect(page).toHaveURL(keep);
      await expect(page.getByRole("link", { name: "Mes anterior" })).toHaveAttribute("aria-current", "true");
    }
    await shot(page, "11-atajos-por-dia");
  });

  test("Celular: Consolidado, Incidencias y Auditoría sin desbordar el ancho", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [url, name] of [
      [`/admin/empresas/${S.companyId}/asistencia?vista=consolidado&from=${S.from}&to=${S.to}`, "07-movil-consolidado"],
      [`/admin/empresas/${S.companyId}/asistencia?vista=incidencias&from=${S.from}&to=${S.to}`, "08-movil-incidencias"],
      ["/admin/auditoria", "09-movil-auditoria"],
      ["/admin/cuentas", "10-movil-cuentas"],
    ]) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), url).toBe(true);
      await shot(page, name);
    }
  });
});
