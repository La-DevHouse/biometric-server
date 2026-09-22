import { test as setup, expect } from "@playwright/test";
import { execSync } from "node:child_process";

export const E2E_EMAIL = "e2e-admin@grupoalco.test";
export const E2E_PASSWORD = "e2e-test-password-123";
const AUTH_FILE = "e2e/.auth/user.json";

setup("crear usuario de prueba y loguearse", async ({ page }) => {
  // scripts/create-user.ts es idempotente (prisma upsert) — reutilizable en
  // cada corrida sin importar si el usuario ya existe de una vez anterior.
  execSync(
    `npx tsx --env-file=.env scripts/create-user.ts "${E2E_EMAIL}" "E2E Admin" "${E2E_PASSWORD}"`,
    { stdio: "inherit" }
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.context().storageState({ path: AUTH_FILE });
});
