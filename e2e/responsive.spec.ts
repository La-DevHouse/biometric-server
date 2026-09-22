import { test, expect } from "@playwright/test";

test.describe("Responsive — mobile", () => {
  // Ancho de teléfono real (iPhone 13), sin heredar `defaultBrowserType` del
  // device descriptor completo — eso solo puede fijarse a nivel de proyecto.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("el menú lateral se abre como drawer off-canvas con el hamburger", async ({ page }) => {
    await page.goto("/admin/empresas");

    const hamburger = page.getByRole("button", { name: "Abrir menú" });
    await expect(hamburger).toBeVisible();

    // El nav de "Empleados" existe en el DOM pero está fuera de pantalla
    // (drawer cerrado) — no debe ser clickeable todavía.
    const empleadosLink = page.getByRole("link", { name: "Empleados" });
    await expect(empleadosLink).not.toBeInViewport();

    await hamburger.click();
    // exact: true — si no, matchea por substring contra el × propio del
    // drawer ("Cerrar menú de navegación"), un control aparte.
    await expect(page.getByRole("button", { name: "Cerrar menú", exact: true })).toBeVisible();
    await expect(empleadosLink).toBeInViewport();

    // Navegar (a una ruta distinta de la actual) cierra el drawer solo — el
    // useEffect de AdminShell dispara con el cambio de pathname.
    await empleadosLink.click();
    await expect(page).toHaveURL(/\/admin\/empleados$/);
    await expect(page.getByRole("button", { name: "Abrir menú" })).toBeVisible();
  });

  test("una tabla ancha se reemplaza por una lista de tarjetas en mobile (no scroll horizontal)", async ({
    page,
  }) => {
    await page.goto("/admin/empleados");

    // La <table> de desktop (min-w-[560px], antes forzaba scroll horizontal
    // o texto amontonado) queda oculta bajo `hidden md:block`; en su lugar
    // se ve un <MobileList> de tarjetas, una por persona.
    await expect(page.locator("table").first()).toBeHidden();
    const mobileList = page.locator("div.md\\:hidden").first();
    await expect(mobileList).toBeVisible();
    await expect(mobileList.locator(":scope > div").first()).toBeVisible();

    // Y la página en sí no se ensancha para acomodar nada.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true
    );
  });

  test("un formulario en diálogo ocupa toda la pantalla, con header fijo, y colapsa a una columna", async ({
    page,
  }) => {
    await page.goto("/admin/empresas");
    await page.getByRole("button", { name: "Nueva empresa" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    const viewportSize = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewportSize).not.toBeNull();
    // Debajo de sm: el diálogo abarca toda la pantalla (w-screen h-screen,
    // sin gutter) — no el modal chico centrado de desktop.
    expect(dialogBox!.x).toBe(0);
    expect(dialogBox!.y).toBe(0);
    expect(dialogBox!.width).toBe(viewportSize!.width);
    expect(dialogBox!.height).toBe(viewportSize!.height);

    // El título + botón de cerrar quedan fijos arriba (no se van con el
    // scroll del body del form).
    await expect(dialog.getByRole("heading", { name: "Nueva empresa cliente" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cerrar" })).toBeVisible();

    // "Umbrales de asistencia" es un <details> colapsado por defecto — hay
    // que abrirlo antes de poder medir los campos de adentro. El summary
    // trae el título + un badge "opcional" separado, así que se busca por
    // el <summary> que contiene el título, no por el texto exacto completo.
    await dialog.locator("summary", { hasText: "Umbrales de asistencia" }).click();

    // Y una vez abierto, sus campos usan `flex flex-col sm:grid sm:grid-cols-2`
    // — a este ancho deben apilarse en una sola columna (mismo x, no lado a lado).
    const late = dialog.locator('input[name="late_tolerance_min"]');
    const early = dialog.locator('input[name="early_leave_tolerance_min"]');
    const lateBox = await late.boundingBox();
    const earlyBox = await early.boundingBox();
    expect(lateBox).not.toBeNull();
    expect(earlyBox).not.toBeNull();
    expect(earlyBox!.y).toBeGreaterThan(lateBox!.y + lateBox!.height - 1);
  });
});
