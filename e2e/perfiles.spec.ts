// QA de perfiles de acceso (docs/18). Crea cuentas "E2E Socio <stamp>" y
// "E2E Lectura <stamp>" en la base de Docker y entra con ellas.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { closeToastIfAny } from "./helpers";

const STAMP = Date.now().toString(36);
const PASSWORD = "e2e-perfil-password-123";
const partner = { name: `E2E Socio ${STAMP}`, email: `e2e-socio-${STAMP}@grupoalco.test` };
const reader = { name: `E2E Lectura ${STAMP}`, email: `e2e-lectura-${STAMP}@grupoalco.test` };

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

async function loginAs(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/\/admin$/, { timeout: 10_000 }).catch(() => page.goto("/admin"));
  await expect(page).toHaveURL(/\/admin$/);
  return page;
}

test.describe.serial("Perfiles de acceso", () => {
  test("Administrador crea un Socio con una empresa y una cuenta de Solo lectura", async ({ page }) => {
    await page.goto("/admin/cuentas");
    await page.getByRole("button", { name: "Nueva cuenta" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre *").fill(partner.name);
    await dialog.getByLabel("Email *").fill(partner.email);
    await dialog.getByLabel("Contraseña inicial *").fill(PASSWORD);
    await dialog.getByLabel("Perfil *").selectOption("operator");
    // Sin empresas no deja.
    await dialog.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Elija al menos una empresa para esta cuenta.")).toBeVisible();
    await closeToastIfAny(page);
    await dialog.getByRole("checkbox").first().check();
    await shot(page, "01-nuevo-socio");
    await dialog.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText(`Cuenta de ${partner.name} creada.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(page.locator("table tbody tr", { hasText: partner.name })).toContainText("Socio");

    await page.getByRole("button", { name: "Nueva cuenta" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre *").fill(reader.name);
    await dialog.getByLabel("Email *").fill(reader.email);
    await dialog.getByLabel("Contraseña inicial *").fill(PASSWORD);
    await dialog.getByLabel("Perfil *").selectOption("viewer");
    await dialog.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText(`Cuenta de ${reader.name} creada.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(page.locator("table tbody tr", { hasText: reader.name })).toContainText("Todas las empresas");
    await shot(page, "02-cuentas");
  });

  test("El Socio no ve ni puede abrir las pantallas de administración", async ({ browser }) => {
    const page = await loginAs(browser, partner.email);
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Empresas" })).toBeVisible();
    for (const hidden of ["Cuentas", "Auditoría", "Categorías"]) await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
    await expect(page.getByText("Socio", { exact: true })).toBeVisible();
    await shot(page, "03-menu-socio");
    for (const url of ["/admin/cuentas", "/admin/auditoria"]) {
      const res = await page.goto(url);
      expect(res?.status()).toBe(404);
    }
    // Cambiar su propia contraseña sí puede (la llave junto a "Salir").
    await page.goto("/admin");
    await page.getByRole("button", { name: "Cambiar mi contraseña" }).click();
    await expect(page.getByRole("dialog").getByLabel("Contraseña actual *")).toBeVisible();
    await page.context().close();
  });

  test("Solo lectura tampoco ve las pantallas de administración", async ({ browser }) => {
    const page = await loginAs(browser, reader.email);
    await expect(page.getByText("Solo lectura", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Cuentas" })).toHaveCount(0);
    expect((await page.goto("/admin/auditoria"))?.status()).toBe(404);
    await page.context().close();
  });
});
