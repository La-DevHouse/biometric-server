// QA de importación: una persona que aparece dos veces en el archivo (varios puestos
// en la empresa) no bloquea; se elige un puesto y queda un solo contrato (docs/14).
// Siembra una empresa con e2e/seed-asistencia.ts (solo en el Postgres de Docker).
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import ExcelJS from "exceljs";
import { closeToastIfAny } from "./helpers";

interface Seed {
  companyId: number;
  companyName: string;
}

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test("Importar: persona con dos puestos — se elige uno y queda un solo contrato", async ({ page }) => {
  const seed: Seed = JSON.parse(execSync("npx tsx --env-file=.env e2e/seed-asistencia.ts", { encoding: "utf8" }).trim().split("\n").pop()!);
  const n = String(Date.now() % 10_000_000).padStart(7, "0");
  const dup = `V-3${n}`;
  const other = `V-2${n}`;

  // Con la forma del listado de Galepso (encabezados en la fila 8).
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RESUMEN DE PAGO");
  ws.getCell("A4").value = "LISTADO DE TRABAJADORES ACTIVOS";
  ws.getRow(8).values = ["N°", "NOMBRES Y APELLIDOS", "CEDULA", "CARGO", "FECHA DE INGRESO"];
  const rows: [string, string, string, Date][] = [
    ["OSMAR JESUS PEREZ CASTILLO E2E", dup, `INSTRUCTOR E2E ${n}`, new Date(Date.UTC(2023, 10, 6))],
    ["ANA MARIA LOPEZ DIAZ E2E", other, `ANALISTA E2E ${n}`, new Date(Date.UTC(2024, 0, 15))],
    ["OSMAR JESUS PEREZ CASTILLO E2E", dup, `PROFESOR POR HORA E2E ${n}`, new Date(Date.UTC(2026, 1, 13))],
  ];
  rows.forEach(([name, ced, cargo, date], i) => {
    ws.getRow(9 + i).values = [i + 1, name, ced, cargo, date];
  });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.goto(`/admin/empresas/${seed.companyId}/importar`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "roster.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });

  // No bloquea: aviso, la persona en la lista, y confirmar deshabilitado hasta elegir.
  const alert = page.getByTestId("duplicados");
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(dup);
  await expect(page.getByText(/no se va a aplicar nada/)).toHaveCount(0);
  const confirm = page.getByRole("button", { name: "Confirmar importación" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("Falta elegir el puesto de 1 persona")).toBeVisible();
  const row = page.locator("table tbody tr", { hasText: dup });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Elija el puesto");
  await shot(page, "01-falta-elegir");

  // Elegir el segundo puesto: la fila de la persona lo refleja, con su fecha de ingreso.
  await alert.getByRole("radio", { name: /Profesor por hora/i }).check();
  await expect(row).toContainText(/Profesor por hora/i);
  await expect(row).toContainText("13/02/2026");
  await expect(confirm).toBeEnabled();
  await shot(page, "02-elegido");
  await confirm.click();
  await expect(page.getByText(/Importación aplicada: 2 persona\(s\) nueva\(s\) · 2 contrato\(s\) nuevo\(s\)/)).toBeVisible({ timeout: 60_000 });
  await closeToastIfAny(page);

  // Queda en la empresa, una sola vez, con un solo contrato y ese puesto.
  await page.goto(`/admin/empleados?q=${encodeURIComponent(dup)}`);
  await page.locator("table tbody tr a").first().click();
  await page.getByRole("navigation", { name: "Secciones del empleado" }).getByRole("link", { name: /Contratos|Contrato/ }).click();
  const contracts = page.locator("table tbody tr");
  await expect(contracts).toHaveCount(1);
  await expect(contracts).toContainText(/Profesor por hora/i);
  await expect(contracts).toContainText("2026-02-13");
  await shot(page, "03-un-contrato");
});
