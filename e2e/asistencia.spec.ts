// QA del motor de asistencia (docs/16, Hito 4 paso 3): asignar horario a varios,
// vista "Por día", filtro por estado, pestaña Asistencia del empleado, "Recalcular"
// y que "Marcaciones" siga igual. Los datos los crea e2e/seed-asistencia.ts — solo
// contra el Postgres de Docker (se niega con cualquier otra base).
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
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

  test("Asignar horario a varios: solo los sin horario", async ({ page }) => {
    await page.goto(`/admin/empresas/${seed.companyId}/empleados`);
    await page.getByRole("button", { name: "Asignar horario" }).click();
    const dialog = page.getByRole("dialog");
    // El select (no las casillas, cuya fila también dice "sin horario").
    await expect(dialog.getByRole("combobox", { name: /^Horario/ })).toHaveValue(/\d+/);
    await dialog.getByRole("button", { name: "solo los sin horario (2)" }).click();
    await shot(page, "02-dialogo-asignar");
    await dialog.getByRole("button", { name: "Asignar a 2 persona(s)" }).click();
    await expect(page.getByText("Horario asignado a 2 persona(s)")).toBeVisible({ timeout: 30_000 });
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
    await shot(page, "06-empleado-asistencia");
    // El "←" vuelve a la empresa, a la misma vista.
    await page.getByRole("link", { name: `← ${seed.companyName}` }).click();
    await expect(page).toHaveURL(/vista=dias/);
  });

  test("Recalcular asistencia del período filtrado", async ({ page }) => {
    await page.goto(daysUrl());
    await page.getByRole("button", { name: "Recalcular asistencia del período filtrado" }).click();
    await expect(page.getByText(/Asistencia calculada del/)).toBeVisible({ timeout: 30_000 });
    await shot(page, "07-recalcular");
    await closeToastIfAny(page);
  });

  test("Marcaciones sigue siendo la vista de siempre", async ({ page }) => {
    await page.goto(daysUrl());
    await page.getByRole("link", { name: "Marcaciones" }).click();
    await expect(page.getByRole("columnheader", { name: "Fecha y hora" })).toBeVisible();
    await expect(page.locator("table tbody tr", { hasText: seed.beto.name }).first()).toBeVisible();
    await shot(page, "08-marcaciones");
  });
});
