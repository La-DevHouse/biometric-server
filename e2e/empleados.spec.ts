import { test, expect } from "@playwright/test";
import { closeToastIfAny, uniqueSuffix } from "./helpers";

test.describe("Empleados — registro y búsqueda", () => {
  test("registra una persona y la encuentra por búsqueda", async ({ page }) => {
    const suffix = uniqueSuffix().replace(/[^0-9]/g, "").padStart(8, "0").slice(0, 8);
    const firstName = "E2E";
    const lastName = `Persona ${suffix}`;

    await page.goto("/admin/empleados");
    const dialog = page.locator("dialog[open]");

    await page.getByRole("button", { name: "Registrar persona" }).click();
    await dialog.locator('select[name="doc_prefix"]').selectOption("V");
    await dialog.locator('input[name="doc_number"]').fill(suffix);
    await dialog.getByLabel("Nombre *").fill(firstName);
    await dialog.getByLabel("Apellido *").fill(lastName);
    await dialog.getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByText(`${firstName} ${lastName} registrado/a.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(dialog).not.toBeVisible();

    // Aparece en la tabla sin filtrar.
    await expect(page.locator("tr", { hasText: lastName })).toBeVisible();

    // Y el filtro de búsqueda por documento la encuentra (se guarda como
    // "V-12345678", con guion — lib/documento.ts `joinDoc`). Los filtros
    // viven ahora dentro del diálogo "Filtros" (ícono de embudo), filtran en
    // vivo por URL (sin botón "Filtrar" que apretar).
    await page.getByRole("button", { name: "Filtros" }).click();
    await dialog.getByLabel("Buscar").fill(`V-${suffix}`);
    await expect(page).toHaveURL(/[?&]q=V-/);
    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await expect(page.locator("tr", { hasText: lastName })).toBeVisible();
    await expect(page.locator("tr", { hasText: lastName })).toContainText(`V-${suffix}`);

    // Sin empleo activo todavía => Pool.
    await expect(page.locator("tr", { hasText: lastName })).toContainText("Pool");

    // Sin contrato vigente: el administrador la puede eliminar, escribiendo el documento.
    await page.locator("tr", { hasText: lastName }).locator("a").first().click();
    await page.getByRole("button", { name: "Eliminar empleado…" }).click();
    const del = page.getByRole("dialog");
    await expect(del.getByText("Se borra definitivamente")).toBeVisible();
    const go = del.getByRole("button", { name: "Eliminar definitivamente" });
    await expect(go).toBeDisabled();
    await del.getByLabel("Documento de la persona").fill(`V-${suffix}`);
    await expect(go).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath("eliminar-empleado.png"), fullPage: true });
    await go.click();
    await expect(page.getByText(`${firstName} ${lastName} fue eliminado/a.`)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/empleados$/);
    await page.goto(`/admin/empleados?q=${encodeURIComponent(`V-${suffix}`)}`);
    await expect(page.locator("tr", { hasText: lastName })).toHaveCount(0);
  });

  test("con contrato vigente no se puede eliminar", async ({ page }) => {
    const { execSync } = await import("node:child_process");
    const seed = JSON.parse(execSync("npx tsx --env-file=.env e2e/seed-asistencia.ts", { encoding: "utf8" }).trim().split("\n").pop()!);
    await page.goto(`/admin/empleados/${seed.ana.id}`);
    await page.getByRole("button", { name: "Eliminar empleado…" }).click();
    const del = page.getByRole("dialog");
    await expect(del.getByText(/No se puede eliminar/)).toBeVisible();
    await expect(del.getByText(seed.companyName)).toBeVisible();
    await expect(del.getByRole("button", { name: "Eliminar definitivamente" })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("eliminar-bloqueado.png"), fullPage: true });
  });
});
