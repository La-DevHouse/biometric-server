import type { Page } from "@playwright/test";

/**
 * El Toaster de la app (components/admin/Toaster.tsx) exige un clic
 * explícito en "Cerrar" — no hay auto-dismiss ni Escape. Un toast sin
 * cerrar bloquea clics posteriores (intercepta pointer events), así que
 * cualquier paso que dispare un toast (guardar un form, etc.) debe pasar
 * por acá antes de seguir interactuando con la página.
 */
export async function closeToastIfAny(page: Page): Promise<void> {
  const closeBtn = page.getByRole("button", { name: "Cerrar" });
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  }
}

/** Sufijo aleatorio para nombres únicos por corrida — evita choques entre corridas sucesivas. */
export function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
