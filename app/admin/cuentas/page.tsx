import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { AccountFormDialog } from "@/components/admin/AccountFormDialog";
import { ResetPasswordDialog } from "@/components/admin/ResetPasswordDialog";
import { ChangeMyPasswordDialog } from "@/components/admin/ChangeMyPasswordDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { setAccountStatusAction } from "./actions";

// force-dynamic: pega a Postgres en un Server Component; con `revalidate` Next
// intenta prerenderizar en build y la BD no resuelve en el builder de Coolify.
export const dynamic = "force-dynamic";

function fmtWhen(d: Date | null): string {
  if (!d) return "Nunca";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default async function CuentasPage() {
  const me = await requireUser();

  const accounts = await prisma.app_user.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      last_login_at: true,
      _count: { select: { sessions: true } },
    },
  });

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-text/60">
          Cuentas internas de Grupo ALCO para entrar al panel. En Fase 1 todas tienen el mismo
          acceso.
        </p>
        <div className="flex items-center gap-2">
          <ChangeMyPasswordDialog />
          <AccountFormDialog />
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Email</Th>
            <Th>Estado</Th>
            <Th>Último ingreso</Th>
            <Th>Sesiones</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <Tr key={a.id}>
              <Td className="font-medium">
                {a.name}
                {a.id === me.id && <span className="text-text/40"> · vos</span>}
              </Td>
              <Td className="font-mono text-xs">{a.email}</Td>
              <Td>
                <Tag variant={a.status === "active" ? "accent" : "neutral"}>
                  {a.status === "active" ? "Activa" : "Inactiva"}
                </Tag>
              </Td>
              <Td className="text-xs">{fmtWhen(a.last_login_at)}</Td>
              <Td className="text-xs">{a._count.sessions}</Td>
              <Td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <AccountFormDialog account={{ id: a.id, name: a.name, email: a.email }} />
                  <ResetPasswordDialog id={a.id} name={a.name} />
                  <RecordStatusButton
                    id={a.id}
                    active={a.status === "active"}
                    label="cuenta"
                    action={setAccountStatusAction}
                  />
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <p className="m-0 max-w-lg text-xs text-text/50">
        Al resetear una contraseña o desactivar una cuenta se cierran sus sesiones abiertas. No podés
        desactivar tu propia cuenta ni la última que quede activa.
      </p>
    </div>
  );
}
