import { prisma } from "@/lib/db";
import { requireAdminPage, PROFILE_LABEL } from "@/lib/access";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
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
  const me = (await requireAdminPage()).user;

  const [accounts, companyRows] = await Promise.all([
    prisma.app_user.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        all_companies: true,
        status: true,
        last_login_at: true,
        companies: { select: { company_id: true, company: { select: { name: true } } }, orderBy: { company: { name: "asc" } } },
        _count: { select: { sessions: true } },
      },
    }),
    prisma.client_company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, group_id: true, group: { select: { name: true } } },
    }),
  ]);
  const companies = companyRows.map((c) => ({ id: c.id, name: c.name, groupId: c.group_id, groupName: c.group?.name ?? null }));
  type Row = (typeof accounts)[number];
  const values = (a: Row) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    role: a.role,
    allCompanies: a.all_companies,
    companyIds: a.companies.map((c) => c.company_id),
  });
  /** "Todas las empresas" o los nombres (los 2 primeros y "+N"). */
  const scopeText = (a: Row) => {
    if (a.all_companies) return "Todas las empresas";
    const names = a.companies.map((c) => c.company.name);
    return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} y ${names.length - 2} más`;
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-text/75">
          Cuentas para entrar al panel. Administrador: todo. Solo lectura: ve y descarga. Socio: trabaja
          solo con sus empresas, sin crear empresas ni editar huellas.
        </p>
        <div className="flex items-center gap-2">
          <ChangeMyPasswordDialog />
          <AccountFormDialog companies={companies} />
        </div>
      </div>

      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Email</Th>
              <Th>Perfil</Th>
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
                  {a.id === me.id && <span className="text-text/60"> · usted</span>}
                </Td>
                <Td className="font-mono text-xs">{a.email}</Td>
                <Td>
                  <div>{PROFILE_LABEL[a.role]}</div>
                  <div className="text-xs text-text/60">{scopeText(a)}</div>
                </Td>
                <Td>
                  <Tag variant={a.status === "active" ? "accent" : "neutral"}>
                    {a.status === "active" ? "Activa" : "Inactiva"}
                  </Tag>
                </Td>
                <Td className="text-xs">{fmtWhen(a.last_login_at)}</Td>
                <Td className="text-xs">{a._count.sessions}</Td>
                <Td actions>
                  <div className="flex flex-nowrap items-center gap-[6px]">
                    <AccountFormDialog account={values(a)} companies={companies} isSelf={a.id === me.id} />
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
      </div>
      <MobileList>
        {accounts.map((a) => (
          <MobileRow
            key={a.id}
            title={
              <>
                {a.name}
                {a.id === me.id && <span className="text-text/60 font-normal"> · usted</span>}
              </>
            }
            tags={
              <Tag variant={a.status === "active" ? "accent" : "neutral"}>
                {a.status === "active" ? "Activa" : "Inactiva"}
              </Tag>
            }
            fields={[
              { label: "Email", value: a.email },
              { label: "Perfil", value: `${PROFILE_LABEL[a.role]} · ${scopeText(a)}` },
              { label: "Último ingreso", value: fmtWhen(a.last_login_at) },
              { label: "Sesiones", value: a._count.sessions },
            ]}
            actions={
              <>
                <AccountFormDialog account={values(a)} companies={companies} isSelf={a.id === me.id} />
                <ResetPasswordDialog id={a.id} name={a.name} />
                <RecordStatusButton
                  id={a.id}
                  active={a.status === "active"}
                  label="cuenta"
                  action={setAccountStatusAction}
                />
              </>
            }
          />
        ))}
      </MobileList>

      <p className="m-0 max-w-lg text-xs text-text/70">
        Al resetear una contraseña o desactivar una cuenta se cierran sus sesiones abiertas. No puede
        desactivar su propia cuenta ni la última que quede activa.
      </p>
    </div>
  );
}
