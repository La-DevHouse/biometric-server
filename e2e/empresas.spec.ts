import { test, expect } from "@playwright/test";
import { closeToastIfAny, uniqueSuffix } from "./helpers";

test.describe("Empresas — jerarquía y modelo de negocio", () => {
  test("crea un grupo, una empresa hija con RIF y modelo de negocio, y ve la jerarquía", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const groupName = `E2E Grupo ${suffix}`;
    const childName = `E2E Sede ${suffix}`;

    await page.goto("/admin/empresas");

    // 1. Crear el grupo (sin RIF).
    await page.getByRole("button", { name: "Nueva empresa" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Razón social").fill(groupName);
    await dialog.getByLabel(/Es un grupo de empresas/).check();
    await dialog.getByRole("button", { name: "Crear empresa" }).click();
    await expect(page.getByText(`Empresa "${groupName}" creada.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(dialog).not.toBeVisible();

    // 2. Crear la empresa hija, con RIF y como hija del grupo recién creado.
    await page.getByRole("button", { name: "Nueva empresa" }).click();
    await dialog.getByLabel("Razón social").fill(childName);
    await dialog.locator('select[name="rif_prefix"]').selectOption("J");
    await dialog.locator('input[name="rif_number"]').fill("123456789");
    await dialog.locator('select[name="parent_id"]').selectOption({ label: groupName });
    await dialog.getByRole("button", { name: "Crear empresa" }).click();
    await expect(page.getByText(`Empresa "${childName}" creada.`)).toBeVisible();
    await closeToastIfAny(page);

    // 3. La tabla debe mostrar la jerarquía: el grupo como raíz y la hija
    // indentada con el prefijo "↳" justo debajo.
    const groupRow = page.locator("tr", { hasText: groupName });
    await expect(groupRow).toBeVisible();
    // exact: true — si no, "Grupo" matchea por substring dentro del propio
    // nombre "E2E Grupo ..." de la fila, no solo el <Tag> de tipo.
    await expect(groupRow.getByText("Grupo", { exact: true })).toBeVisible();

    const childRow = page.locator("tr", { hasText: childName });
    await expect(childRow).toBeVisible();
    await expect(childRow).toContainText("↳");
    await expect(childRow).toContainText("J-123456789");
  });
});
