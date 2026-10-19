import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { allow } from "@/lib/access";
import { writeAudit } from "@/lib/audit";
import { companyIncidents, companySummary } from "@/lib/attendance/reports";
import { buildIncidentsXlsx, buildSummaryXlsx, reportFileName } from "@/lib/export/reports";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function bad(message: string, status = 400) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * GET /admin/empresas/[id]/asistencia/reporte?tipo=consolidado|incidencias&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Descarga el reporte del período en .xlsx (Hito 5, docs/17): lo mismo que muestra
 * la vista "Consolidado" o "Incidencias" con ese rango. Queda en la auditoría.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return bad("Empresa inválida.");
  const g = await allow({ company: id });
  if (!g.ok) return bad("No encontrado.", 404);
  const user = g.access.user;

  const sp = req.nextUrl.searchParams;
  const tipo = sp.get("tipo");
  if (tipo !== "consolidado" && tipo !== "incidencias") return bad("Reporte desconocido.");
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!YMD.test(from) || !YMD.test(to)) return bad("Elija el rango de fechas (desde y hasta).");
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) return bad("Fecha inválida.");
  if (fromD > toD) return bad("La fecha desde no puede ser posterior a la fecha hasta.");
  if ((toD.getTime() - fromD.getTime()) / 86_400_000 >= MAX_DAYS) return bad(`El rango no puede pasar de ${MAX_DAYS} días.`);

  const company = await prisma.client_company.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!company) return bad("La empresa no existe.", 404);

  const now = new Date();
  let buf: Buffer;
  let rows: number;
  if (tipo === "consolidado") {
    const data = await companySummary(id, from, to);
    buf = await buildSummaryXlsx({ companyName: company.name, from, to, generatedAt: now, rows: data });
    rows = data.length;
  } else {
    const data = await companyIncidents(id, from, to);
    buf = await buildIncidentsXlsx({ companyName: company.name, from, to, generatedAt: now, rows: data });
    rows = data.length;
  }
  const fileName = reportFileName(company.name, tipo === "consolidado" ? "Consolidado" : "Incidencias", from, to);
  await writeAudit({
    actorId: user.id,
    action: "attendance.report",
    entityType: "client_company",
    entityId: company.id,
    after: { report: tipo, from, to, rows },
  });

  // filename= ASCII de respaldo + filename*= UTF-8 (tildes y ñ).
  const ascii = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
