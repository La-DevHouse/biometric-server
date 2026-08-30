import { Suspense } from "react";
import { allAsync, initDb } from "@/lib/db";
import { DeviceSelect } from "@/components/ui/DeviceSelect";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpButton } from "@/components/admin/OpButton";
import { CreateUserDialog } from "@/components/admin/CreateUserDialog";
import { RenameUserDialog } from "@/components/admin/RenameUserDialog";
import { ChangePrivilegeDialog } from "@/components/admin/ChangePrivilegeDialog";
import { DeleteUserDialog } from "@/components/admin/DeleteUserDialog";
import { ViewBiometricsDialog } from "@/components/admin/ViewBiometricsDialog";
import { syncUsersAction } from "@/app/admin/actions";

export const revalidate = 3;

interface UserRow {
  user_id: string;
  user_name: string | null;
  user_privilege: string | null;
  bio_count: number;
}

async function getData(devId: string | undefined) {
  await initDb();

  const devices = await allAsync<{ dev_id: string; fk_name: string | null }>(
    `SELECT dev_id, fk_name FROM devices ORDER BY dev_id`
  );

  const effectiveDevId = devId || devices[0]?.dev_id;
  if (!effectiveDevId) return { devices, effectiveDevId: undefined, users: [] as UserRow[] };

  const users = await allAsync<UserRow>(
    `SELECT u.user_id, u.user_name, u.user_privilege,
            COUNT(e.id) AS bio_count
       FROM users u
       LEFT JOIN enroll_data e ON e.dev_id = u.dev_id AND e.user_id = u.user_id
      WHERE u.dev_id = ?
      GROUP BY u.id
      ORDER BY NULLIF(regexp_replace(u.user_id, '\\D', '', 'g'), '')::bigint NULLS LAST, u.user_id`,
    [effectiveDevId]
  );

  return { devices, effectiveDevId, users };
}

function PrivilegeTag({ privilege }: { privilege: string | null }) {
  if (privilege === "MANAGER") return <Tag variant="accent">MANAGER</Tag>;
  if (!privilege) return <span className="text-text/50">—</span>;
  return <Tag variant="neutral">{privilege}</Tag>;
}

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string }>;
}) {
  const { dev } = await searchParams;
  const { devices, effectiveDevId, users } = await getData(dev);

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <div className="flex items-center gap-3 flex-wrap">
        <Suspense fallback={<div className="min-h-9 w-40 bg-surface border border-divider" />}>
          <DeviceSelect
            devices={devices.map((d) => ({ dev_id: d.dev_id, label: d.fk_name || d.dev_id }))}
            allowAll={false}
          />
        </Suspense>
        {effectiveDevId && (
          <>
            <OpButton action={syncUsersAction} hidden={{ dev_id: effectiveDevId }}>
              Sincronizar lista desde el equipo
            </OpButton>
            <div className="ml-auto">
              <CreateUserDialog devId={effectiveDevId} />
            </div>
          </>
        )}
      </div>

      {!effectiveDevId ? (
        <EmptyState
          title="Todavía no hay dispositivos"
          description="Conecta un equipo para poder gestionar usuarios."
        />
      ) : users.length === 0 ? (
        <EmptyState
          title="Sin usuarios en este equipo"
          description='Da de alta el primero, o sincroniza la lista si el equipo ya tiene usuarios cargados.'
          action={<CreateUserDialog devId={effectiveDevId} />}
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>Nombre</Th>
                <Th>Privilegio</Th>
                <Th>Biométricos</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.user_id}>
                  <Td className="font-mono">{u.user_id}</Td>
                  <Td>{u.user_name || <span className="text-text/50">Sin nombre</span>}</Td>
                  <Td>
                    <PrivilegeTag privilege={u.user_privilege} />
                  </Td>
                  <Td>
                    {u.bio_count > 0 ? (
                      `${u.bio_count} plantilla${u.bio_count === 1 ? "" : "s"}`
                    ) : (
                      <span className="text-text/50">Sin sincronizar</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1.5 flex-wrap">
                      <RenameUserDialog
                        devId={effectiveDevId!}
                        userId={u.user_id}
                        currentName={u.user_name || ""}
                      />
                      <ChangePrivilegeDialog
                        devId={effectiveDevId!}
                        userId={u.user_id}
                        currentPrivilege={u.user_privilege}
                      />
                      <ViewBiometricsDialog devId={effectiveDevId!} userId={u.user_id} />
                      <DeleteUserDialog
                        devId={effectiveDevId!}
                        userId={u.user_id}
                        userName={u.user_name || ""}
                      />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-text/50 max-w-lg">
            Nombre y privilegio se editan por separado: cada uno usa su propio comando seguro. No
            existe la edición libre de "toda la ficha" porque reconstruye al usuario en el equipo y
            borra temporalmente sus huellas.
          </p>
        </>
      )}
    </div>
  );
}
