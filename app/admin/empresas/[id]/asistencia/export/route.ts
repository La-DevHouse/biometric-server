import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { companyAttendance, companyAttendanceSites, type DeviceUserAssignment } from "@/lib/companyAttendance";
import { buildGalepsoXlsx, galepsoFileName } from "@/lib/export/galepso";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function bad(message: string, status = 400) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

const MAX_ASSIGN = 200;

/**
 * `asg` = JSON [{dev_id, user_id, employee_id}] — IDs de equipo sin empleado que en
 * este archivo cuentan como de esa persona (R10). null = mal formado.
 */
function parseAssign(raw: string | null): DeviceUserAssignment[] | null {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length > MAX_ASSIGN) return null;
    const out: DeviceUserAssignment[] = [];
    for (const a of v) {
      if (!a || typeof a !== "object") return null;
      const { dev_id, user_id, employee_id } = a as Record<string, unknown>;
      if (typeof dev_id !== "string" || typeof user_id !== "string" || !Number.isInteger(employee_id)) return null;
      out.push({ dev_id, user_id, employee_id: employee_id as number });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * GET /admin/empresas/[id]/asistencia/export?from=YYYY-MM-DD&to=YYYY-MM-DD[&sede=id][&asg=…]
 * Descarga el .xlsx para Galepso (docs/11 R1–R8) con exactamente lo que muestra
 * Empresa → Asistencia con esos filtros (por contrato, C4), más las marcaciones de
 * IDs sin empleado asignadas en el aviso previo (R10, solo para este archivo).
 * Rango obligatorio. Cada descarga queda en `export_run` (R7).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return bad("Empresa inválida.");

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!YMD.test(from) || !YMD.test(to)) return bad("Elija el rango de fechas (desde y hasta) para exportar.");
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) return bad("Fecha inválida.");
  if (fromD > toD) return bad("La fecha desde no puede ser posterior a la fecha hasta.");
  if ((toD.getTime() - fromD.getTime()) / 86_400_000 >= MAX_DAYS) return bad(`El rango no puede pasar de ${MAX_DAYS} días.`);

  const company = await prisma.client_company.findUnique({ where: { id }, select: { id: true, name: true, tax_id: true } });
  if (!company) return bad("La empresa no existe.", 404);

  let siteId: number | null = null;
  if (sp.get("sede")) {
    siteId = Number(sp.get("sede"));
    const sites = await companyAttendanceSites(id);
    if (!sites.some((s) => s.id === siteId)) return bad("Esa sede no está en el alcance de la empresa.");
  }

  // Asignaciones de IDs sin empleado, solo para este archivo (R10): no se guardan.
  const assign = parseAssign(sp.get("asg"));
  if (assign === null) return bad("Asignación de marcaciones inválida.");
  if (assign.length > 0) {
    const ok = await prisma.employee.count({
      where: { id: { in: [...new Set(assign.map((a) => a.employee_id))] }, employments: { some: { company_id: id } } },
    });
    if (ok !== new Set(assign.map((a) => a.employee_id)).size) return bad("Solo se puede asignar a una persona con contrato en esta empresa.");
  }

  const rows = await companyAttendance(id, { from, to, siteId, order: "asc", assign });
  const now = new Date();
  const buf = await buildGalepsoXlsx({ companyName: company.name, from, to, generatedAt: now, rows });
  const fileName = galepsoFileName(company.name, company.tax_id, now);

  const run = await prisma.export_run.create({
    data: {
      period_start: fromD,
      period_end: toD,
      scope: "company",
      scope_company_id: company.id,
      generated_by: user.id,
      generated_at: now,
      file_ref: fileName,
      row_count: rows.length,
    },
  });
  await writeAudit({
    actorId: user.id,
    action: "attendance.export",
    entityType: "export_run",
    entityId: run.id,
    after: { company_id: company.id, from, to, site_id: siteId, rows: rows.length, format: "galepso_xlsx", assigned: assign },
  });

  // filename= ASCII de respaldo + filename*= UTF-8 (tildes y ñ en "Relación").
  const ascii = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
