// Datos de prueba EN PRODUCCIÓN, solo en la empresa "COLEGIO PRUEBA" (autorizado
// por el usuario el 2026-10-19: es una empresa de pruebas). Para e2e/prod-colegio.spec.ts.
//
// Sin efectos en los equipos físicos: NO crea personas ni equipos (el reconciliador
// enrolaría gente nueva en los faciales). Usa dos personas que ya tienen contrato con
// la empresa y les inserta marcaciones de una semana pasada en la que no marcaron
// nada, como si vinieran de un equipo de la empresa. Todo queda marcado para poder
// limpiarlo: attendance_logs.verify_mode = 'E2E'.
//
// Guarda: E2E_PROD_COMPANY tiene que ser exactamente "COLEGIO PRUEBA" y existir una
// sola empresa con ese nombre. Imprime un JSON (última línea) con lo que sembró.
import { prisma, runAsync } from "@/lib/db";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { addDays, isoWeekday } from "@/lib/attendance/compute";

const COMPANY = "COLEGIO PRUEBA";

async function main() {
  if (process.env.E2E_PROD_COMPANY !== COMPANY) {
    throw new Error(`seed-prod-colegio: defina E2E_PROD_COMPANY="${COMPANY}" para confirmar la empresa. No se siembra nada.`);
  }
  const companies = await prisma.client_company.findMany({
    where: { name: { equals: COMPANY, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (companies.length !== 1) throw new Error(`seed-prod-colegio: se esperaba una sola empresa "${COMPANY}", hay ${companies.length}.`);
  const company = companies[0];

  const device = await prisma.devices.findFirst({
    where: { site: { company_id: company.id, status: "active" } },
    select: { dev_id: true, name: true, site_id: true },
    orderBy: { dev_id: "asc" },
  });
  if (!device) throw new Error("seed-prod-colegio: la empresa no tiene equipos en una sede activa.");

  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  const contracts = await prisma.employment.findMany({
    where: { company_id: company.id, end_date: null },
    select: { id: true, start_date: true, employee: { select: { id: true, national_id: true, first_name: true, last_name: true } } },
    orderBy: { id: "asc" },
  });
  const digits = (nid: string) => nid.replace(/\D/g, "");

  // La semana (lun–vie) más reciente, de hace al menos 2 semanas, en la que haya dos
  // personas con contrato ya vigente el lunes y SIN ninguna marcación esa semana.
  let monday = addDays(today, -(isoWeekday(today) - 1) - 14);
  let pair: typeof contracts = [];
  for (let i = 0; i < 12 && pair.length < 2; i++, monday = addDays(monday, -7)) {
    const from = `${monday.replace(/-/g, "")}000000`;
    const to = `${addDays(monday, 6).replace(/-/g, "")}235959`;
    pair = [];
    for (const c of contracts) {
      if (c.start_date.toISOString().slice(0, 10) > monday) continue;
      const n = await prisma.attendance_logs.count({ where: { user_id: digits(c.employee.national_id), io_time: { gte: from, lte: to } } });
      if (n === 0) pair.push(c);
      if (pair.length === 2) break;
    }
  }
  if (pair.length < 2) throw new Error("seed-prod-colegio: no hay una semana con dos personas con contrato y sin marcaciones.");
  // El paso del for (−7) corre antes de comprobar la condición: volver a la semana elegida.
  monday = addDays(monday, 7);
  const [a, b] = pair;
  const day = (i: number) => addDays(monday, i).replace(/-/g, "");

  const mark = (nid: string, io: string) =>
    runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time, verify_mode) VALUES (?, ?, ?, 'E2E')`, [device.dev_id, digits(nid), io]);
  // A: los 5 días a tiempo. B: lun tardanza 25, mar nada (ausente), mié una sola, jue sale 30 antes, vie bien.
  for (let i = 0; i < 5; i++) {
    await mark(a.employee.national_id, `${day(i)}075800`);
    await mark(a.employee.national_id, `${day(i)}170300`);
  }
  await mark(b.employee.national_id, `${day(0)}082500`);
  await mark(b.employee.national_id, `${day(0)}170000`);
  await mark(b.employee.national_id, `${day(2)}080000`);
  await mark(b.employee.national_id, `${day(3)}080000`);
  await mark(b.employee.national_id, `${day(3)}163000`);
  await mark(b.employee.national_id, `${day(4)}080000`);
  await mark(b.employee.national_id, `${day(4)}170000`);

  // Horario de prueba de la empresa (08:00–17:00 L–V, descanso 12–13, 8 h); se asigna desde la UI.
  const stamp = Date.now().toString(36);
  const schedule = await prisma.schedule_group.create({
    data: {
      company_id: company.id,
      name: `E2E QA Diurno ${stamp}`,
      shifts: {
        create: {
          name: "08:00 a 17:00",
          start_time: "08:00",
          end_time: "17:00",
          break_start: "12:00",
          break_end: "13:00",
          hours: 8,
          workdays: [1, 2, 3, 4, 5],
          effective_from: new Date(`${addDays(today, -400)}T00:00:00Z`),
        },
      },
    },
  });

  const who = (c: (typeof contracts)[number]) => ({
    id: c.employee.id,
    employmentId: c.id,
    name: `${c.employee.last_name}, ${c.employee.first_name}`,
    cedula: digits(c.employee.national_id),
  });
  process.stdout.write(
    JSON.stringify({
      companyId: company.id,
      companyName: company.name,
      devId: device.dev_id,
      deviceName: device.name || device.dev_id,
      scheduleName: schedule.name,
      from: monday,
      to: addDays(monday, 4),
      ana: who(a),
      beto: who(b),
    }) + "\n"
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
