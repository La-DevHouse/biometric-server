// Correcciones manuales de marcaciones (docs/16, Hito 4 paso 4): agregar una que
// falta o anular una del equipo, siempre con motivo, quién y cuándo. Nunca se toca
// attendance_logs: companyAttendance aplica las correcciones vigentes al leer, así
// que la vista, el export y el motor ven lo mismo. Después de cada cambio se
// recalculan los días alrededor (un turno nocturno puede tomar la marcación del día
// anterior).
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { companyAttendance, companyAttendanceSites, companyAttendanceView } from "@/lib/companyAttendance";
import { DEFAULT_TZ, parseDeviceTime } from "@/lib/time";
import { addDays } from "./compute";
import { computeCompanyAttendance } from "./engine";

export type CorrectionResult = { ok: true; companyId: number; employeeId: number } | { ok: false; error: string };

/** Motivo mínimo: algo que se entienda después en la auditoría. */
const MIN_REASON = 5;

export interface CorrectionInfo {
  id: number;
  reason: string;
  actor: string;
  /** Cuándo se hizo. */
  at: Date;
}

export interface DayMark {
  /** attendance_logs.id, o -id de la corrección si es manual. */
  id: number;
  ymd: string;
  /** "HH:MM" */
  time: string;
  device: string;
  site: string;
  manual: boolean;
  /** La corrección que la agregó (solo manuales). */
  correction: CorrectionInfo | null;
}

export interface VoidedMark {
  logId: number;
  ymd: string;
  time: string;
  device: string;
  correction: CorrectionInfo;
}

export interface DayMarks {
  employmentId: number;
  companyId: number;
  employeeId: number;
  ymd: string;
  marks: DayMark[];
  voided: VoidedMark[];
  sites: { id: number; name: string }[];
  /** Sede sugerida para una marcación nueva: la de las marcaciones del día, o la primera de la empresa. */
  defaultSiteId: number | null;
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const ioYmd = (io: string) => `${io.slice(0, 4)}-${io.slice(4, 6)}-${io.slice(6, 8)}`;
const ioHm = (io: string) => `${io.slice(8, 10)}:${io.slice(10, 12)}`;
const dayStart = (ymd: string) => `${ymd.replace(/-/g, "")}000000`;
const dayEnd = (ymd: string) => `${ymd.replace(/-/g, "")}235959`;

/** Hora de pared de `d` en Caracas, "YYYYMMDDhhmmss". */
function wallOf(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

async function correctionInfo(ids: number[]): Promise<Map<number, CorrectionInfo & { logId: number | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.attendance_correction.findMany({
    where: { id: { in: ids } },
    select: { id: true, reason: true, created_at: true, attendance_log_id: true, actor: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, { id: r.id, reason: r.reason, actor: r.actor.name, at: r.created_at, logId: r.attendance_log_id }]));
}

/**
 * Las marcaciones que cuentan para el día `ymd` de un contrato (las mismas que usa
 * el motor), las anuladas de ese día, y las sedes donde se puede agregar una. Si
 * la salida calculada cae al día siguiente (turno nocturno), incluye hasta esa hora.
 */
export async function dayMarks(employmentId: number, ymd: string): Promise<DayMarks | null> {
  const em = await prisma.employment.findUnique({
    where: { id: employmentId },
    select: { id: true, company_id: true, employee_id: true },
  });
  if (!em) return null;
  const day = await prisma.attendance_day.findUnique({
    where: { employment_id_date: { employment_id: employmentId, date: new Date(`${ymd}T00:00:00Z`) } },
    select: { last_out: true },
  });
  const lastOutWall = day?.last_out ? wallOf(day.last_out) : null;
  const end = lastOutWall && lastOutWall > dayEnd(ymd) ? lastOutWall : dayEnd(ymd);

  const rows = (await companyAttendanceView(em.company_id, { from: ymd, to: ioYmd(end), order: "asc" })).filter(
    (r) => r.employee_id === em.employee_id && r.io_time >= dayStart(ymd) && r.io_time <= end
  );
  const info = await correctionInfo(rows.filter((r) => r.manual).map((r) => -r.id));
  const marks: DayMark[] = rows.map((r) => ({
    id: r.id,
    ymd: ioYmd(r.io_time),
    time: ioHm(r.io_time),
    device: r.device_name,
    site: r.site_name,
    manual: r.manual,
    correction: r.manual ? (info.get(-r.id) ?? null) : null,
  }));

  const voids = await prisma.attendance_correction.findMany({
    where: { employment_id: employmentId, kind: "void_mark", revoked_at: null },
    select: { id: true, attendance_log_id: true },
  });
  const logs = voids.length
    ? await prisma.attendance_logs.findMany({
        where: { id: { in: voids.map((v) => v.attendance_log_id!) }, io_time: { gte: dayStart(ymd), lte: end } },
        select: { id: true, io_time: true, dev_id: true },
      })
    : [];
  const devNames = new Map(
    (await prisma.devices.findMany({ where: { dev_id: { in: logs.map((l) => l.dev_id) } }, select: { dev_id: true, name: true } })).map(
      (d) => [d.dev_id, d.name || d.dev_id]
    )
  );
  const voidInfo = await correctionInfo(voids.filter((v) => logs.some((l) => l.id === v.attendance_log_id)).map((v) => v.id));
  const voided: VoidedMark[] = [...voidInfo.values()]
    .map((c) => {
      const l = logs.find((x) => x.id === c.logId)!;
      return { logId: l.id, ymd: ioYmd(l.io_time!), time: ioHm(l.io_time!), device: devNames.get(l.dev_id) ?? l.dev_id, correction: c };
    })
    .sort((a, b) => (a.ymd + a.time).localeCompare(b.ymd + b.time));

  const active = (await companyAttendanceSites(em.company_id)).filter((s) => s.status === "active");
  const sites = active.map((s) => ({ id: s.id, name: s.company_id === em.company_id ? s.name : `${s.name} (${s.company.name})` }));
  const firstSite = rows.find((r) => sites.some((s) => s.id === r.site_id))?.site_id;
  const ownSite = active.find((s) => s.company_id === em.company_id)?.id;
  return {
    employmentId,
    companyId: em.company_id,
    employeeId: em.employee_id,
    ymd,
    marks,
    voided,
    sites,
    defaultSiteId: firstSite ?? ownSite ?? sites[0]?.id ?? null,
  };
}

async function recomputeAround(companyId: number, ymd: string) {
  await computeCompanyAttendance(companyId, addDays(ymd, -1), addDays(ymd, 1));
}

function checkReason(reason: string): string | null {
  return reason.trim().length >= MIN_REASON ? null : "Indique el motivo de la corrección (al menos 5 caracteres).";
}

/**
 * Agrega una marcación que falta: `time` "HH:MM" del día `ymd` (o del siguiente,
 * con `nextDay`, para la salida de un turno nocturno), en una sede del alcance.
 */
export async function addMark(
  input: { employmentId: number; ymd: string; time: string; nextDay?: boolean; siteId: number; reason: string },
  actorId: number
): Promise<CorrectionResult> {
  const bad = checkReason(input.reason);
  if (bad) return { ok: false, error: bad };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.ymd) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    return { ok: false, error: "Indique una hora válida." };
  }
  const em = await prisma.employment.findUnique({
    where: { id: input.employmentId },
    select: { company_id: true, employee_id: true, start_date: true, end_date: true },
  });
  if (!em) return { ok: false, error: "El contrato no existe." };
  const markYmd = input.nextDay ? addDays(input.ymd, 1) : input.ymd;
  if (markYmd < ymdOf(em.start_date) || (em.end_date && markYmd > ymdOf(em.end_date))) {
    return { ok: false, error: "Esa fecha está fuera del contrato." };
  }
  const site = (await companyAttendanceSites(em.company_id)).find((s) => s.id === input.siteId);
  if (!site) return { ok: false, error: "Esa sede no es de la empresa." };
  const tz = (await prisma.site.findUnique({ where: { id: site.id }, select: { timezone: true } }))?.timezone ?? DEFAULT_TZ;
  const io = `${markYmd.replace(/-/g, "")}${input.time.replace(":", "")}00`;
  const instant = parseDeviceTime(io, tz);
  if (!instant || instant.getTime() > Date.now()) return { ok: false, error: "La marcación no puede ser futura." };

  const c = await prisma.attendance_correction.create({
    data: {
      employment_id: input.employmentId,
      kind: "add_mark",
      io_time: io,
      site_id: site.id,
      reason: input.reason.trim(),
      actor_app_user_id: actorId,
    },
  });
  await writeAudit({ actorId, action: "attendance.correction.add_mark", entityType: "attendance_correction", entityId: c.id, after: c });
  await recomputeAround(em.company_id, markYmd);
  return { ok: true, companyId: em.company_id, employeeId: em.employee_id };
}

/** Anula una marcación del equipo que hoy cuenta para esta persona en esta empresa. */
export async function voidMark(
  input: { employmentId: number; logId: number; reason: string },
  actorId: number
): Promise<CorrectionResult> {
  const bad = checkReason(input.reason);
  if (bad) return { ok: false, error: bad };
  const em = await prisma.employment.findUnique({ where: { id: input.employmentId }, select: { company_id: true, employee_id: true } });
  if (!em) return { ok: false, error: "El contrato no existe." };
  const log = await prisma.attendance_logs.findUnique({ where: { id: input.logId }, select: { io_time: true } });
  if (!log?.io_time || !/^\d{14}$/.test(log.io_time)) return { ok: false, error: "La marcación no existe." };
  const ymd = ioYmd(log.io_time);
  const counted = await companyAttendance(em.company_id, { from: ymd, to: ymd });
  if (!counted.some((r) => r.id === input.logId && r.employee_id === em.employee_id)) {
    return { ok: false, error: "Esa marcación ya no cuenta para esta persona (¿ya está anulada?). Recargue." };
  }
  let c;
  try {
    c = await prisma.attendance_correction.create({
      data: {
        employment_id: input.employmentId,
        kind: "void_mark",
        attendance_log_id: input.logId,
        reason: input.reason.trim(),
        actor_app_user_id: actorId,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: "Esa marcación ya está anulada." };
    throw e;
  }
  await writeAudit({ actorId, action: "attendance.correction.void_mark", entityType: "attendance_correction", entityId: c.id, after: c });
  await recomputeAround(em.company_id, ymd);
  return { ok: true, companyId: em.company_id, employeeId: em.employee_id };
}

/** Deshace una corrección (queda quién y cuándo; no se borra). */
export async function revokeCorrection(correctionId: number, actorId: number): Promise<CorrectionResult> {
  const c = await prisma.attendance_correction.findUnique({
    where: { id: correctionId },
    include: { employment: { select: { company_id: true, employee_id: true } } },
  });
  if (!c) return { ok: false, error: "La corrección no existe." };
  if (c.revoked_at) return { ok: false, error: "Esa corrección ya se deshizo." };
  const io =
    c.io_time ??
    (c.attendance_log_id != null
      ? (await prisma.attendance_logs.findUnique({ where: { id: c.attendance_log_id }, select: { io_time: true } }))?.io_time
      : null);
  const after = await prisma.attendance_correction.update({
    where: { id: correctionId },
    data: { revoked_at: new Date(), revoked_by_app_user_id: actorId },
  });
  await writeAudit({ actorId, action: "attendance.correction.revoke", entityType: "attendance_correction", entityId: c.id, before: c, after });
  if (io && /^\d{14}$/.test(io)) await recomputeAround(c.employment.company_id, ioYmd(io));
  return { ok: true, companyId: c.employment.company_id, employeeId: c.employment.employee_id };
}
