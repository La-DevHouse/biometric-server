import { test, expect, type Page } from "@playwright/test";
import { closeToastIfAny, uniqueSuffix } from "./helpers";

/**
 * Cada fila de esta página embebe su propio <dialog> de edición en el DOM
 * (cerrado, pero presente) — y el de "Puesto" repite los nombres de TODOS
 * los modelos de negocio como labels de checkbox. Eso contamina un simple
 * `tr:has-text(nombre)` a nivel de página: el nombre de un modelo de
 * negocio nuevo aparece también dentro de la fila de un puesto cualquiera.
 * Por eso cada búsqueda se escopea a su propia sección (por heading), no a
 * toda la página.
 */
function sectionByHeading(page: Page, heading: RegExp) {
  return page.locator("section", { has: page.getByRole("heading", { name: heading }) });
}

test.describe("Categorías — modelos de negocio y puestos M:N", () => {
  test("crea un modelo de negocio y un puesto ligado a él, y uno genérico", async ({ page }) => {
    const suffix = uniqueSuffix();
    const modelName = `E2E Modelo ${suffix}`;
    const positionName = `E2E Puesto ${suffix}`;
    const genericPositionName = `E2E Genérico ${suffix}`;

    await page.goto("/admin/categorias");
    const dialog = page.locator("dialog[open]");
    const modelsSection = sectionByHeading(page, /^Modelos de negocio/);
    const positionsSection = sectionByHeading(page, /^Puestos/);

    // 1. Modelo de negocio.
    await page.getByRole("button", { name: "Nuevo modelo de negocio" }).click();
    await dialog.getByLabel("Nombre *").fill(modelName);
    await dialog.getByRole("button", { name: "Crear" }).click();
    await expect(page.getByText(`Modelo de negocio "${modelName}" creado.`)).toBeVisible();
    await closeToastIfAny(page);

    const modelRow = modelsSection.locator("tr", { hasText: modelName });
    await expect(modelRow).toBeVisible();

    // 2. Puesto ligado a ese modelo (M:N).
    await page.getByRole("button", { name: "Nuevo puesto" }).click();
    await dialog.getByLabel("Nombre *").fill(positionName);
    await dialog.getByRole("checkbox", { name: modelName }).check();
    await dialog.getByRole("button", { name: "Crear" }).click();
    await expect(page.getByText(`Puesto "${positionName}" creado.`)).toBeVisible();
    await closeToastIfAny(page);

    const positionRow = positionsSection.locator("tr", { hasText: positionName });
    await expect(positionRow).toBeVisible();
    await expect(positionRow.locator("td").nth(3)).toHaveText("1"); // columna "Modelos"

    // 3. Puesto genérico (sin ningún modelo marcado).
    await page.getByRole("button", { name: "Nuevo puesto" }).click();
    await dialog.getByLabel("Nombre *").fill(genericPositionName);
    await dialog.getByRole("button", { name: "Crear" }).click();
    await expect(page.getByText(`Puesto "${genericPositionName}" creado.`)).toBeVisible();
    await closeToastIfAny(page);

    const genericRow = positionsSection.locator("tr", { hasText: genericPositionName });
    await expect(genericRow).toBeVisible();
    await expect(genericRow).toContainText("Genérico");
  });
});
