// QA de Auditoría (registro de quién hizo qué). Usa lo que dejaron otras pruebas en
// la base de Docker (correcciones, reportes y horarios del usuario e2e-admin); si
// corre sola sobre una base vacía, al menos verifica la pantalla y los filtros.
import { test, expect, type Page } from "@playwright/test";

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test("Auditoría: desde el menú, con filtros por área y paginación", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Auditoría" }).first().click();
  await expect(page).toHaveURL(/\/admin\/auditoria$/);
  await expect(page.getByText(/Quién hizo qué y cuándo/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Acción" })).toBeVisible();
  await shot(page, "01-auditoria");

  // Solo asistencia: lo que hizo la prueba de asistencia (correcciones, reportes).
  await page.goto("/admin/auditoria?area=asistencia");
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  const actions = await rows.locator("td:nth-child(3)").allInnerTexts();
  const ok = /marcación|corrección|reporte|asistencia/i;
  expect(actions.every((a) => ok.test(a))).toBe(true);
  await expect(rows.filter({ hasText: "Agregó una marcación a mano" }).first()).toContainText("E2E Admin");
  await shot(page, "02-asistencia");

  // Un rango sin nada.
  await page.goto("/admin/auditoria?from=2001-01-01&to=2001-01-02");
  await expect(page.getByText("Nada registrado con esos filtros")).toBeVisible();
});
