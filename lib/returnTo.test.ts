import { test } from "node:test";
import { strict as assert } from "node:assert";
import { companyReturn, withReturn } from "./returnTo";

test("companyReturn: solo rutas internas de una empresa", () => {
  assert.deepEqual(companyReturn("/admin/empresas/12/empleados"), { path: "/admin/empresas/12/empleados", companyId: 12 });
  assert.deepEqual(companyReturn("/admin/empresas/3/asistencia?from=2026-10-01&to=2026-10-15&sede=4")?.companyId, 3);
  assert.equal(companyReturn("/admin/empresas/3")?.companyId, 3);
  for (const bad of ["https://evil.example/admin/empresas/1", "//evil.example", "/admin/empleados", "/admin/empresas/x/sedes", "/admin/empresas/1/../../x", undefined, null, ["/admin/empresas/1"]]) {
    assert.equal(companyReturn(bad as string), null, String(bad));
  }
});

test("withReturn: agrega ?volver codificado, o deja el href si no hay regreso", () => {
  assert.equal(withReturn("/admin/empleados/5", null), "/admin/empleados/5");
  assert.equal(withReturn("/admin/empleados/5", "/admin/empresas/1/empleados"), "/admin/empleados/5?volver=%2Fadmin%2Fempresas%2F1%2Fempleados");
  assert.equal(
    withReturn("/admin/empleados/5?x=1", "/admin/empresas/1/asistencia?from=a&to=b"),
    "/admin/empleados/5?x=1&volver=%2Fadmin%2Fempresas%2F1%2Fasistencia%3Ffrom%3Da%26to%3Db"
  );
});
