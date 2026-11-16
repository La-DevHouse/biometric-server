// Formulario de contrato: empresa a todo el ancho, buscador legible, y sede (informativa):
// sola con una sede, obligatoria con varias. Siembra con e2e/seed-asistencia.ts (solo Docker).
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { closeToastIfAny } from "./helpers";

interface Seed {
  companyId: number;
  companyName: string;
  from: string;
  ana: { id: number; name: string; cedula: string };
}

const seed = (args = ""): Seed =>
  JSON.parse(execSync(`npx tsx --env-file=.env e2e/seed-asistencia.ts ${args}`, { encoding: "utf8" }).trim().split("\n").pop()!);
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
const stampOf = (s: Seed) => s.companyName.replace("E2E Asistencia ", "");

test("Contrato en una empresa con varias sedes: hay que elegir la sede, y se ve en el contrato y en la empresa", async ({ page }) => {
  const one = seed();
  const two = seed("--dos-sedes");

  await page.goto(`/admin/empleados/${one.ana.id}/contratos`);
  await page.getByRole("button", { name: "Nuevo contrato" }).click();
  const dialog = page.getByRole("dialog");

  // La empresa ocupa todo el ancho y el buscador muestra nombre y RIF sin apretujarse.
  const company = dialog.getByRole("combobox", { name: "Empresa" });
  const sede = dialog.getByLabel("Sede");
  const companyBox = (await company.boundingBox())!;
  const sedeBox = (await sede.boundingBox())!;
  expect(companyBox.width).toBeGreaterThan(sedeBox.width * 1.8);
  await company.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await shot(page, "01-buscador-empresa");
  await company.fill(stampOf(two));
  await page.getByRole("option", { name: new RegExp(two.companyName) }).click();

  // Varias sedes: obligatoria. Sin elegirla, el navegador no deja enviar.
  await expect(dialog.getByText("Sede *")).toBeVisible();
  await dialog.locator('input[name="start_date"]').fill(two.from);
  await dialog.getByRole("button", { name: "Registrar contrato" }).click();
  await expect(dialog).toBeVisible();
  await sede.selectOption({ label: "Sede E2E Norte" });
  await shot(page, "02-sede-elegida");
  await dialog.getByRole("button", { name: "Registrar contrato" }).click();
  await expect(page.getByText(/^Contrato registrado\./)).toBeVisible({ timeout: 30_000 });
  await closeToastIfAny(page);
  await expect(page.locator("table tbody tr", { hasText: two.companyName })).toContainText("Sede E2E Norte");

  // Una empresa con una sola sede: se asigna sola, sin preguntar.
  await page.getByRole("button", { name: "Editar contrato" }).last().click();
  await expect(page.getByRole("dialog").getByLabel("Sede")).toBeDisabled();
  await expect(page.getByRole("dialog").getByLabel("Sede")).toHaveValue(/\d+/);
  await page.keyboard.press("Escape");

  // En la empresa de dos sedes: columna Sede y filtro; los contratos sembrados no la tienen.
  await page.goto(`/admin/empresas/${two.companyId}/empleados`);
  await expect(page.locator("table thead")).toContainText("Sede");
  const anaRow = (p: Page) => p.locator("table tbody tr", { hasText: one.ana.cedula });
  await expect(anaRow(page)).toContainText("Sede E2E Norte");
  await expect(page.locator("table tbody")).toContainText("Falta elegir");
  await page.goto(`/admin/empresas/${two.companyId}/empleados?sede=ninguna`);
  await expect(page.locator("table tbody")).toContainText("Falta elegir");
  await expect(anaRow(page)).toHaveCount(0);
  await shot(page, "03-empleados-por-sede");
});
