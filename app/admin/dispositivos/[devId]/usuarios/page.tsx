import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { allAsync, initDb, prisma } from "@/lib/db";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpButton } from "@/components/admin/OpButton";
import { DeviceTabs } from "@/components/admin/DeviceTabs";
import { RenameUserDialog } from "@/components/admin/RenameUserDialog";
import { ChangePrivilegeDialog } from "@/components/admin/ChangePrivilegeDialog";
import { DeleteUserDialog } from "@/components/admin/DeleteUserDialog";
import { ViewBiometricsDialog } from "@/components/admin/ViewBiometricsDialog";
import { syncUsersAction } from "@/app/admin/actions";
import { deviceSyncState } from "@/lib/sync/reconcile";
import { PRIVILEGE_SCREEN_LABEL } from "@/lib/operations";
import { cx } from "@/lib/cx";
import { desiredFingerprintIdsMany } from "@/lib/fingerprints";

export const dynamic = "force-dynamic";

interface UserRow {
  user_id: string;
  user_name: string | null;
  user_privilege: string | null;
  bio_count: number;
}

function PrivilegeTag({ privilege }: { privilege: string | null }) {
  if (!privilege) return <span className="text-text/70">—</span>;
  const label = PRIVILEGE_SCREEN_LABEL[privilege] ?? privilege;
  return <Tag variant={privilege === "MANAGER" ? "accent" : "neutral"}>{label}</Tag>;
}

/**
 * Equipo → Usuarios (docs/11 E6): los usuarios del equipo según su última
 * lectura, con su empleado vinculado por cédula, cuántas huellas tiene en el
 * equipo y su estado (como en Empresa → Empleados), las acciones de la vieja "Usuarios de equipo" y lo pendiente que
 * mostraba la vieja "Enrolamiento" (qué falta, qué sobra, qué no se toca).
 */
export default async function DeviceUsersPage({ params }: { params: Promise<{ devId: string }> }) {
  await requireUser();
  await initDb();
  const { devId } = await params;

  const [users, slots, state] = await Promise.all([
    allAsync<UserRow>(
      `SELECT u.user_id, u.user_name, u.user_privilege, COUNT(e.id)::int AS bio_count
         FROM users u
         LEFT JOIN enroll_data e ON e.dev_id = u.dev_id AND e.user_id = u.user_id AND e.backup_number BETWEEN 0 AND 9
        WHERE u.dev_id = ?
        GROUP BY u.id
        ORDER BY NULLIF(regexp_replace(u.user_id, '\\D', '', 'g'), '')::bigint NULLS LAST, u.user_id`,
      [devId]
    ),
    prisma.device_fingerprint_slot.findMany({ where: { dev_id: devId }, select: { device_user_id: true, fingerprint_id: true } }),
    deviceSyncState(devId),
  ]);
  const employees = await prisma.employee.findMany({
    where: { id: { in: [...state.employeeByUser.values()] } },
    select: { id: true, first_name: true, last_name: true },
  });
  const empName = new Map(employees.map((e) => [e.id, `${e.last_name}, ${e.first_name}`]));
  // Quién está en el alcance: si se lo borra a mano, el reconciliador lo vuelve a crear.
  const inScope = new Set(state.inScope.map((e) => e.cedula));
  // Huellas y estado como en Empresa → Empleados, pero en ESTE equipo: cuántas
  // tiene acá, y si están todas las que la persona debería tener (sus copias
  // canónicas, hasta 10).
  const desired = await desiredFingerprintIdsMany([...new Set(state.employeeByUser.values())]);
  const slotSet = new Set(slots.filter((s) => s.fingerprint_id != null).map((s) => `${s.device_user_id}|${s.fingerprint_id}`));
  const fpStatus = (u: UserRow): { label: string; variant: "accent" | "neutral"; title?: string } | null => {
    const eid = state.employeeByUser.get(u.user_id);
    if (!eid) return null; // sin empleado: no se sincroniza
    const want = desired.get(eid)?.ids ?? [];
    if (want.length === 0) {
      return u.bio_count > 0
        ? { label: "Por asignar", variant: "neutral", title: "Tiene huella en el equipo; se asigna a la persona en la próxima sincronización." }
        : { label: "Sin huella", variant: "neutral", title: "La persona no tiene huellas registradas todavía." };
    }
    const here = want.filter((f) => slotSet.has(`${u.user_id}|${f}`)).length;
    return here === want.length
      ? { label: "Al día", variant: "accent" }
      : { label: `Faltan huellas (${here} de ${want.length})`, variant: "neutral", title: "La sincronización copia las que faltan." };
  };
  const statusCell = (u: UserRow) => {
    const st = fpStatus(u);
    if (!st) return <span className="text-text/60">—</span>;
    return (
      <span title={st.title}>
        <Tag variant={st.variant}>{st.label}</Tag>
      </span>
    );
  };
  const p = state.plan;

  const actions = (u: UserRow) => (
    <>
      <RenameUserDialog devId={devId} userId={u.user_id} currentName={u.user_name || ""} />
      <ChangePrivilegeDialog devId={devId} userId={u.user_id} currentPrivilege={u.user_privilege} />
      <ViewBiometricsDialog devId={devId} userId={u.user_id} />
      <DeleteUserDialog inScope={inScope.has(u.user_id)} devId={devId} userId={u.user_id} userName={u.user_name || ""} />
    </>
  );
  const employeeCell = (userId: string) => {
    const eid = state.employeeByUser.get(userId);
    return eid ? (
      <Link href={`/admin/empleados/${eid}`} className="text-accent no-underline hover:underline">
        {empName.get(eid)}
      </Link>
    ) : (
      <Tag variant="neutral">sin empleado</Tag>
    );
  };

  return (
    <div className="flex max-w-[1100px] flex-col gap-5">
      <DeviceTabs devId={devId} active="usuarios" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-text/75">
          {users.length} usuario(s) según la última lectura. Las altas y bajas las hace el reconciliador por cédula.
        </p>
        <OpButton
          action={syncUsersAction}
          hidden={{ dev_id: devId }}
          title="Releer usuarios del equipo"
          description="Vuelve a leer la lista completa de usuarios del equipo (incluidos los que no tienen huella). No cambia nada en el equipo."
          variant="icon"
        >
          {Icon.sync}
        </OpButton>
      </div>

      {state.frozen ? (
        <p className="m-0 text-sm text-text/70">
          Sin sede activa: el equipo está congelado, no se agrega ni se quita a nadie.
        </p>
      ) : (
        p && (
          <div className="grid gap-3 md:grid-cols-2">
            <Bucket title="Faltan en el equipo (se agregan)">{p.add.map((e) => `${e.name} (${e.cedula})`)}</Bucket>
            <Bucket title="Con huellas incompletas (se completan)">
              {p.complete.map((e) => `${e.name} (${e.cedula}) — faltan ${e.missingFingerprints}`)}
            </Bucket>
            <Bucket title="Fuera del alcance (se quitan)" tone="warn">
              {[...p.remove, ...p.held].map((r) => `${empName.get(r.employeeId) ?? r.userId} (${r.userId})`)}
            </Bucket>
            <Bucket title="Admins fuera del alcance (nunca se tocan)">
              {p.protectedUsers.map((u) => {
                const eid = state.employeeByUser.get(u);
                return `${eid ? empName.get(eid) : u} (${u}) — ${state.deviceUsers.get(u) ?? "privilegio desconocido"}`;
              })}
            </Bucket>
            <Bucket
              title="IDs que no son la cédula de ningún empleado (no se tocan)"
              hint="Si es alguien con un ID viejo (no su cédula): cuando su copia con cédula esté en el equipo, borrá el ID viejo desde esta lista y sus marcaciones pasan a la cédula (docs/10 §4.5)."
            >
              {p.unknownUsers.map((u) => `${u} — ${users.find((x) => x.user_id === u)?.user_name ?? "?"}`)}
            </Bucket>
          </div>
        )
      )}

      {users.length === 0 ? (
        <EmptyState
          title="Sin usuarios leídos"
          description="Todavía no hay lectura de este equipo. Usá “Actualizar” arriba o “Releer usuarios”."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>Nombre en equipo</Th>
                  <Th>Privilegio</Th>
                  <Th>Empleado</Th>
                  <Th>Huellas</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Tr key={u.user_id}>
                    <Td className="font-mono">{u.user_id}</Td>
                    <Td>{u.user_name || <span className="text-text/70">Sin nombre</span>}</Td>
                    <Td>
                      <PrivilegeTag privilege={u.user_privilege} />
                    </Td>
                    <Td>{employeeCell(u.user_id)}</Td>
                    <Td>{u.bio_count}</Td>
                    <Td>{statusCell(u)}</Td>
                    <Td actions>
                      <div className="flex flex-nowrap justify-end gap-[6px]">{actions(u)}</div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {users.map((u) => (
              <MobileRow
                key={u.user_id}
                title={u.user_name || "Sin nombre"}
                tags={<PrivilegeTag privilege={u.user_privilege} />}
                fields={[
                  { label: "ID", value: u.user_id },
                  { label: "Empleado", value: employeeCell(u.user_id) },
                  { label: "Huellas", value: u.bio_count },
                  { label: "Estado", value: statusCell(u) },
                ]}
                actions={actions(u)}
              />
            ))}
          </MobileList>
          <p className="m-0 max-w-lg text-xs text-text/70">
            Nombre y privilegio se editan por separado: cada uno usa su propio comando seguro. No existe la edición libre
            de &quot;toda la ficha&quot; porque reconstruye al usuario en el equipo y borra temporalmente sus huellas.
          </p>
        </>
      )}
    </div>
  );
}

/** Un grupo de pendientes; vacío = no se muestra (lo normal es que todo esté al día). */
function Bucket({
  title,
  hint,
  tone,
  children,
}: {
  title: string;
  hint?: string;
  tone?: "warn";
  children: string[];
}) {
  if (children.length === 0) return null;
  return (
    <div className={cx("flex flex-col gap-1 border p-3 text-sm", tone === "warn" ? "border-accent2" : "border-divider")}>
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text/70">
        {title} · {children.length}
      </p>
      <ul className="m-0 pl-4">
        {children.slice(0, 50).map((c) => (
          <li key={c}>{c}</li>
        ))}
        {children.length > 50 && <li>… y {children.length - 50} más.</li>}
      </ul>
      {hint && <p className="m-0 text-xs text-text/60">{hint}</p>}
    </div>
  );
}
