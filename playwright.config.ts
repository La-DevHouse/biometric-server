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
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
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
