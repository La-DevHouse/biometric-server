// Datos de muestra para revisar el diseño de Inicio / Dispositivos /
// Asistencia sin un equipo biométrico real conectado (docs/09 — no hay forma
// remota de simular un dispositivo real sin electricidad en sitio).
//
// Inserta 2 dispositivos "MOCK-" (uno online, uno offline con un comando
// pendiente), unos usuarios enrolados de muestra y marcaciones de los
// últimos 4 días. Todo prefijado "MOCK-" / nombres de prueba — reproducible
// (upsert) y fácil de limpiar: `npm run seed:demo -- --clear`.
//
//   tsx --env-file=.env scripts/seed-demo-activity.ts [--clear]

import { prisma, closeDb } from "@/lib/db";

const DEV_ONLINE = "MOCK-DEV01";
const DEV_OFFLINE = "MOCK-DEV02";

const PEOPLE = [
  { user_id: "1001", name: "Gladys Rondón" },
  { user_id: "1002", name: "Carlos Uzcátegui" },
  { user_id: "1003", name: "María Fernanda Pérez" },
  { user_id: "1004", name: "José Gregorio Blanco" },
];

async function clear() {
  await prisma.attendance_logs.deleteMany({ where: { dev_id: { in: [DEV_ONLINE, DEV_OFFLINE] } } });
  await prisma.commands.deleteMany({ where: { dev_id: { in: [DEV_ONLINE, DEV_OFFLINE] } } });
  await prisma.users.deleteMany({ where: { dev_id: { in: [DEV_ONLINE, DEV_OFFLINE] } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: [DEV_ONLINE, DEV_OFFLINE] } } });
  console.log("✓ datos MOCK-* eliminados");
}

function ioTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function seed() {
  const now = Date.now();

  await prisma.devices.upsert({
    where: { dev_id: DEV_ONLINE },
    update: { last_seen_at: now, firmware: "WS535BW1_BSCS_v1.5.31" },
    create: {
      dev_id: DEV_ONLINE,
      fk_name: "Recepción — Demo",
      firmware: "WS535BW1_BSCS_v1.5.31",
      last_seen_at: now,
      stat_user_count: PEOPLE.length,
      stat_fp_count: PEOPLE.length,
    },
  });

  await prisma.devices.upsert({
    where: { dev_id: DEV_OFFLINE },
    update: {},
    create: {
      dev_id: DEV_OFFLINE,
      fk_name: "Planta — Demo",
      firmware: "WS535BW1_BSCS_v1.5.31",
      last_seen_at: now - 2 * 60 * 60 * 1000, // hace 2h — se ve "Desconectado"
      stat_user_count: PEOPLE.length,
      stat_fp_count: PEOPLE.length,
    },
  });

  for (const dev_id of [DEV_ONLINE, DEV_OFFLINE]) {
    for (const p of PEOPLE) {
      await prisma.users.upsert({
        where: { dev_id_user_id: { dev_id, user_id: p.user_id } },
        update: { user_name: p.name },
        create: { dev_id, user_id: p.user_id, user_name: p.name, user_privilege: "USER" },
      });
    }
  }

  // Comando encolado sin recoger — el dispositivo offline no lo pudo buscar.
  await prisma.commands.create({
    data: {
      dev_id: DEV_OFFLINE,
      cmd_code: "SET_TIME",
      cmd_param: "{}",
      status: "WAIT",
    },
  });

  // Marcaciones de los últimos 4 días (entrada/salida por persona), más
  // densas hoy para que "Marcaciones hoy" y Asistencia se vean con datos.
  let created = 0;
  for (let daysAgo = 3; daysAgo >= 0; daysAgo--) {
    for (const p of PEOPLE) {
      const day = new Date(now - daysAgo * 24 * 60 * 60 * 1000);

      const checkIn = new Date(day);
      checkIn.setHours(7, 50 + Math.floor(Math.random() * 20), Math.floor(Math.random() * 60), 0);
      const checkOut = new Date(day);
      checkOut.setHours(16, 55 + Math.floor(Math.random() * 20), Math.floor(Math.random() * 60), 0);

      const dev_id = Math.random() > 0.5 ? DEV_ONLINE : DEV_OFFLINE;

      for (const [mark, ioMode] of [
        [checkIn, 0],
        [checkOut, 1],
      ] as const) {
        const io_time = ioTime(mark as Date);
        await prisma.attendance_logs.upsert({
          where: { dev_id_user_id_io_time: { dev_id, user_id: p.user_id, io_time } },
          update: {},
          create: {
            dev_id,
            user_id: p.user_id,
            io_time,
            io_mode: ioMode,
            verify_mode: Math.random() > 0.3 ? "FP" : "PASSWORD",
          },
        });
        created++;
      }
    }
  }

  console.log(`✓ 2 dispositivos (${DEV_ONLINE} online, ${DEV_OFFLINE} offline con 1 pendiente)`);
  console.log(`✓ ${PEOPLE.length} usuarios enrolados por dispositivo`);
  console.log(`✓ ${created} marcaciones (últimos 4 días)`);
  console.log(
    `\nNota: "En línea" decae a los 30s de correr esto (last_seen_at estático) — volvé a correr el script para refrescarlo.`
  );
}

async function main() {
  if (process.argv.includes("--clear")) {
    await clear();
  } else {
    await seed();
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
