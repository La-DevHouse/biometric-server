// Datos de prueba para e2e/asistencia.spec.ts (motor de asistencia, docs/16).
// Crea una empresa "E2E Asistencia <stamp>" con sede, equipo, un horario 08:00–17:00
// L–V y dos personas SIN horario (el test se lo asigna desde la UI), con las
// marcaciones de la semana pasada. Imprime un JSON con los ids.
//
// Solo contra el Postgres de Docker (puerto 55432): nunca contra producción.
import { prisma, runAsync } from "@/lib/db";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { addDays, isoWeekday } from "@/lib/attendance/compute";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1):55432\//.test(url)) {
    throw new Error("seed-asistencia: DATABASE_URL no es el Postgres de Docker (55432). No se siembra nada.");
  }
  const stamp = Date.now().toString(36);
  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  const monday = addDays(today, -(isoWeekday(today) - 1) - 7); // lunes de la semana pasada
  const day = (i: number) => addDays(monday, i).replace(/-/g, "");
  const start = new Date(`${addDays(today, -60)}T00:00:00Z`);

  const company = await prisma.client_company.create({
    data: { name: `E2E Asistencia ${stamp}`, tax_id: "J-00000000-0", sites: { create: { name: "Sede E2E" } } },
    include: { sites: true },
  });
  const devId = `E2E${stamp}`;
  await prisma.devices.create({ data: { dev_id: devId, name: `Equipo E2E ${stamp}`, site_id: company.sites[0].id } });
  const schedule = await prisma.schedule_group.create({
    data: {
      company_id: company.id,
      name: `E2E Diurno ${stamp}`,
      shifts: {
        create: {
          name: "08:00 a 17:00",
          start_time: "08:00",
          end_time: "17:00",
          break_start: "12:00",
          break_end: "13:00",
          hours: 8,
          workdays: [1, 2, 3, 4, 5],
          effective_from: new Date(`${addDays(today, -90)}T00:00:00Z`),
        },
      },
    },
  });

  const seed = String(Date.now() % 1_000_000).padStart(6, "0");
  const person = async (n: number, first: string, last: string) => {
    const cedula = `4${n}${seed}`;
    const e = await prisma.employee.create({ data: { national_id: `V-${cedula}`, first_name: first, last_name: `${last} E2E` } });
    await prisma.employment.create({ data: { employee_id: e.id, company_id: company.id, start_date: start } });
    return { id: e.id, cedula, name: `${last} E2E, ${first}` };
  };
  const ana = await person(1, "Ana", "Puntual");
  const beto = await person(2, "Beto", "Variado");

  const mark = (cedula: string, io: string) =>
    runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time) VALUES (?, ?, ?)`, [devId, cedula, io]);
  for (let i = 0; i < 5; i++) {
    await mark(ana.cedula, `${day(i)}075800`);
    await mark(ana.cedula, `${day(i)}170300`);
  }
  await mark(beto.cedula, `${day(0)}082500`); // lunes: tardanza 25 min
  await mark(beto.cedula, `${day(0)}170000`);
  // martes: nada → ausente
  await mark(beto.cedula, `${day(2)}080000`); // miércoles: una sola → incompleto
  await mark(beto.cedula, `${day(3)}080000`); // jueves: salida anticipada 30 min
  await mark(beto.cedula, `${day(3)}163000`);
  await mark(beto.cedula, `${day(4)}080000`); // viernes: presente
  await mark(beto.cedula, `${day(4)}170000`);

  process.stdout.write(
    JSON.stringify({
      companyId: company.id,
      companyName: company.name,
      scheduleName: schedule.name,
      from: addDays(monday, 0),
      to: addDays(monday, 4),
      ana,
      beto,
    })
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
