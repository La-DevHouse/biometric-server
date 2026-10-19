import { defineConfig, devices } from "@playwright/test";

/**
 * Suite de smoke E2E del panel admin (docs/qa-hito-3.md). Corre contra el
 * server real (Postgres + Next vía server.ts), sin mocks — es la validación
 * barata y repetible de que el CRUD sigue funcionando después de cada
 * cambio, sin gastar una pasada de QA manual completa en cada ocasión.
 *
 * Prerrequisitos (una vez): `docker compose up -d db` + `npm run db:migrate:deploy`.
 * El proyecto "setup" crea/resetea el usuario de prueba solo (idempotente).
 *
 * Fuera de alcance a propósito: los flujos de escaneo de cédula/RIF por foto
 * (Gemini) — requieren API key real, cuestan dinero por corrida y
 * getUserMedia no es practicable en CI. Esos se cubren aparte con
 * `npm run test-vision` (llamada real sin UI) y a mano
 * (docs/qa-hito-3.md §2.7 / §5.1b).
 */
// Corrida de QA con evidencia (E2E_RUN_DIR=e2e/.artifacts/runs/<fecha-hora>): video y
// trace de cada test + reporte HTML en esa carpeta. Sin la variable, como siempre.
const RUN_DIR = process.env.E2E_RUN_DIR;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: RUN_DIR ? [["list"], ["html", { outputFolder: `${RUN_DIR}/report`, open: "never" }]] : [["list"]],
  outputDir: RUN_DIR ? `${RUN_DIR}/test-results` : undefined,
  // Con evidencia se corre contra un server de desarrollo aparte, que compila cada
  // página la primera vez: más margen para las esperas.
  expect: { timeout: RUN_DIR ? 20_000 : 5_000 },
  timeout: RUN_DIR ? 120_000 : 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: RUN_DIR ? "on" : "retain-on-failure",
    video: RUN_DIR ? "on" : "off",
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO || 0) },
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "admin",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
