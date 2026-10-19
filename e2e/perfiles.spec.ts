// QA de perfiles de acceso (docs/18). Siembra dos empresas (A y B, con e2e/seed-asistencia.ts,
// solo en el Postgres de Docker), crea "E2E Socio <stamp>" con acceso solo a A y
// "E2E Lectura <stamp>" (todas, solo ver), y entra con cada una.
import { test, expect, type Browser, type Page } from "@playwright/test";
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

const STAMP = Date.now().toString(36);
const PASSWORD = "e2e-perfil-password-123";
const partner = { name: `E2E Socio ${STAMP}`, email: `e2e-socio-${STAMP}@grupoalco.test` };
const reader = { name: `E2E Lectura ${STAMP}`, email: `e2e-lectura-${STAMP}@grupoalco.test` };
let A: Seed;
let B: Seed;

const seed = (): Seed => JSON.parse(execSync("npx tsx --env-file=.env e2e/seed-asistencia.ts", { encoding: "utf8" }).trim().split("\n").pop()!);
const stampOf = (s: Seed) => s.companyName.replace("E2E Asistencia ", "");
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
  test.beforeAll(() => {
    A = seed();
    B = seed();
  });

  test("Administrador crea un Socio (solo la empresa A) y una cuenta de Solo lectura", async ({ page }) => {
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
    await dialog.getByLabel("Buscar empresa").fill(A.companyName);
    await dialog.getByRole("checkbox", { name: A.companyName }).check();
    await shot(page, "01-nuevo-socio");
    await dialog.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText(`Cuenta de ${partner.name} creada.`)).toBeVisible();
    await closeToastIfAny(page);
    await expect(page.locator("table tbody tr", { hasText: partner.name })).toContainText(`Socio${A.companyName}`);

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

  test("Socio: menú sin administración y solo ve su empresa, sus equipos y su gente", async ({ browser }) => {
    const page = await loginAs(browser, partner.email);
    const nav = page.getByRole("navigation");
    for (const hidden of ["Cuentas", "Auditoría", "Categorías"]) await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Equipos/ })).toContainText("1");
    await expect(page.getByText(`Equipo E2E ${stampOf(B)}`)).toHaveCount(0);
    await shot(page, "03-inicio-socio");

    // Empresas: solo A, sin "Nueva empresa".
    await page.goto("/admin/empresas");
    await expect(page.getByRole("link", { name: A.companyName }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: B.companyName })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nueva empresa" })).toHaveCount(0);
    await shot(page, "04-empresas-socio");

    // Lo ajeno "no existe": empresa, equipo, persona; y las pantallas de administración.
    for (const url of [
      `/admin/empresas/${B.companyId}`,
      `/admin/empresas/${B.companyId}/asistencia`,
      `/admin/dispositivos/E2E${stampOf(B)}`,
      `/admin/empleados/${B.ana.id}`,
      "/admin/cuentas",
      "/admin/auditoria",
      "/admin/categorias",
    ]) {
      expect((await page.goto(url))?.status(), url).toBe(404);
    }

    // Equipos: solo el de A.
    await page.goto("/admin/dispositivos");
    await expect(page.getByText(`Equipo E2E ${stampOf(A)}`).first()).toBeVisible();
    await expect(page.getByText(`Equipo E2E ${stampOf(B)}`)).toHaveCount(0);

    // Empleados: los de A; "Nuevo empleado" pide la empresa del contrato.
    await page.goto(`/admin/empleados?q=${encodeURIComponent("E2E")}`);
    await expect(page.locator("table tbody tr", { hasText: A.ana.name.split(",")[0] }).first()).toBeVisible();
    await expect(page.locator(`a[href^="/admin/empleados/${B.ana.id}"]`)).toHaveCount(0);
    await page.getByRole("button", { name: "Registrar persona" }).click();
    await expect(page.getByRole("dialog").getByLabel("Empresa del contrato *")).toBeVisible();
    await page.keyboard.press("Escape");

    // Ficha de un empleado de A: puede editar, pero no borrar usuarios del equipo (huellas).
    await page.goto(`/admin/dispositivos/E2E${stampOf(A)}/usuarios`);
    await expect(page.getByRole("button", { name: /Eliminar usuario/ })).toHaveCount(0);

    // Buscador: la empresa B no aparece.
    const res = await page.request.get(`/api/search?q=${encodeURIComponent(stampOf(B))}`);
    expect((await res.json()).hits).toEqual([]);
    await page.context().close();
  });

  test("Solo lectura: ve todo pero no hay botones para cambiar nada", async ({ browser }) => {
    const page = await loginAs(browser, reader.email);
    await expect(page.getByText("Solo lectura", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Cuentas" })).toHaveCount(0);

    // Ve las dos empresas.
    await page.goto(`/admin/empresas/${B.companyId}`);
    await expect(page.getByRole("button", { name: "Editar empresa" })).toHaveCount(0);
    // Asistencia: sin recalcular ni corregir, pero puede descargar.
    await page.goto(`/admin/empresas/${A.companyId}/asistencia?vista=dias&from=${A.from}&to=${A.to}`);
    await expect(page.getByRole("button", { name: "Corregir marcaciones" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Recalcular/ })).toHaveCount(0);
    await page.goto(`/admin/empresas/${A.companyId}/asistencia?vista=consolidado&from=${A.from}&to=${A.to}`);
    await expect(page.getByRole("link", { name: "Descargar .xlsx" })).toBeVisible();
    await shot(page, "05-lectura-consolidado");
    // Importar escribe: no entra.
    expect((await page.goto(`/admin/empresas/${A.companyId}/importar`))?.status()).toBe(404);
    await page.context().close();
  });
});
