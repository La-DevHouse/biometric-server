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
  });
});
