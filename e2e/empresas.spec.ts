import { test, expect } from "@playwright/test";
import { closeToastIfAny, uniqueSuffix } from "./helpers";

test.describe("Empresas — grupos, primera sede y RIF", () => {
  test("crea un grupo, una empresa del grupo con su primera sede, y la ve bajo el grupo", async ({ page }) => {
    const suffix = uniqueSuffix();
    const groupName = `E2E Grupo ${suffix}`;
    const companyName = `E2E Empresa ${suffix}`;

    await page.goto("/admin/empresas");

    // 1. Crear el grupo: entidad propia, solo nombre + compartir empleados (docs/10 R1).
    await page.getByRole("button", { name: "+ Nuevo grupo" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Nombre").fill(groupName);
    await expect(dialog.getByLabel(/Compartir empleados/)).toBeChecked(); // default activado
    await dialog.getByRole("button", { name: "Crear grupo" }).click();
    await expect(page.getByText(`Grupo "${groupName}" creado.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(dialog).not.toBeVisible();

    // 2. Crear la empresa: RIF obligatorio, grupo elegido, y su primera sede
    // en el mismo formulario (no es un paso opcional posterior, docs/10 R2).
    await page.getByRole("button", { name: "Nueva empresa" }).click();
    await dialog.getByLabel("Razón social").fill(companyName);
    await dialog.locator('select[name="rif_prefix"]').selectOption("J");
    await dialog.locator('input[name="rif_number"]').fill("123456789");
    await dialog.locator('select[name="group_id"]').selectOption({ label: groupName });
    await dialog.getByLabel("Nombre de la sede").fill("Sede Centro");
    await dialog.getByRole("button", { name: "Crear empresa" }).click();
    await expect(page.getByText(`Empresa "${companyName}" creada con la sede "Sede Centro".`)).toBeVisible();
    await closeToastIfAny(page);

    // 3. La tabla muestra el grupo como encabezado y la empresa debajo, indentada.
    const groupRow = page.locator("tr", { hasText: groupName });
    await expect(groupRow).toBeVisible();
    await expect(groupRow).toContainText("Comparte empleados");

    const companyRow = page.locator("tr", { hasText: companyName });
    await expect(companyRow).toBeVisible();
    await expect(companyRow).toContainText("↳");
    await expect(companyRow).toContainText("J-123456789");
  });

  test("no deja crear una empresa sin su primera sede", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/admin/empresas");
    await page.getByRole("button", { name: "Nueva empresa" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Razón social").fill(`E2E Sin Sede ${suffix}`);
    await dialog.locator('input[name="rif_number"]').fill("987654321");
    await dialog.getByRole("button", { name: "Crear empresa" }).click();
    // el campo de sede es required: el navegador no envía el form
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Nombre de la sede")).toHaveJSProperty("validity.valueMissing", true);
  });
});
