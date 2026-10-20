// Deshace en producción lo que dejó e2e/prod-colegio.spec.ts, SOLO en "COLEGIO PRUEBA":
//   - marcaciones sembradas (attendance_logs.verify_mode = 'E2E') de los equipos de la empresa;
//   - correcciones con motivo "(QA E2E)";
//   - horarios "E2E QA …" (sus turnos, su historial por contrato y el horario de los contratos);
// y recalcula la asistencia de la empresa de los últimos 60 días. Misma guarda que el seed.
import { prisma } from "@/lib/db";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { addDays } from "@/lib/attendance/compute";
import { computeCompanyAttendance } from "@/lib/attendance/engine";

const COMPANY = "COLEGIO PRUEBA";

async function main() {
  if (process.env.E2E_PROD_COMPANY !== COMPANY) throw new Error(`prod-cleanup: defina E2E_PROD_COMPANY="${COMPANY}".`);
  const companies = await prisma.client_company.findMany({ where: { name: { equals: COMPANY, mode: "insensitive" } }, select: { id: true } });
  if (companies.length !== 1) throw new Error(`prod-cleanup: se esperaba una sola empresa "${COMPANY}".`);
  const companyId = companies[0].id;

  const devIds = (await prisma.devices.findMany({ where: { site: { company_id: companyId } }, select: { dev_id: true } })).map((d) => d.dev_id);
  const logs = await prisma.attendance_logs.deleteMany({ where: { dev_id: { in: devIds }, verify_mode: "E2E" } });

  const corrections = await prisma.attendance_correction.deleteMany({
    where: { employment: { company_id: companyId }, reason: { contains: "(QA E2E)" } },
  });

  const groups = (await prisma.schedule_group.findMany({ where: { company_id: companyId, name: { startsWith: "E2E QA" } }, select: { id: true } })).map((g) => g.id);
  const touched = (await prisma.employment.findMany({ where: { company_id: companyId, schedule_history: { some: { schedule_group_id: { in: groups } } } }, select: { id: true } })).map((e) => e.id);
  // Quitar el horario de los contratos (el trigger deja un tramo "sin horario" desde hoy) y
  // borrar el historial de esos contratos: antes de la prueba no tenían ninguno.
  await prisma.employment.updateMany({ where: { id: { in: touched }, schedule_group_id: { in: groups } }, data: { schedule_group_id: null } });
  const history = await prisma.employment_schedule.deleteMany({ where: { employment_id: { in: touched } } });
  const schedules = await prisma.schedule_group.deleteMany({ where: { id: { in: groups } } });

  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  const r = await computeCompanyAttendance(companyId, addDays(today, -60), addDays(today, -1));
  console.log(
    `[prod-cleanup] marcaciones ${logs.count}, correcciones ${corrections.count}, horarios ${schedules.count}, ` +
      `tramos de horario ${history.count}; asistencia recalculada (${r.days} días)`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
