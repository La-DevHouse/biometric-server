import type { ReactNode } from "react";
import { Card, CardKicker, CardMeta } from "./Card";
import Link from "next/link";
import { LinkBtn } from "./Btn";

export function StatCard({
  kicker,
  value,
  meta,
  tone = "accent",
  linkHref,
  linkLabel,
  href,
}: {
  kicker: string;
  value: ReactNode;
  meta?: ReactNode;
  /** Color del kicker y de las marcas de esquina — cada métrica tiene el suyo, no es un solo acento fijo para toda la grilla. */
  tone?: "accent" | "accent2";
  linkHref?: string;
  linkLabel?: string;
  /** Toda la tarjeta es un link (ej. "Equipos en línea" → lista filtrada, docs/11 E2). Excluye linkHref. */
  href?: string;
}) {
  const card = (
    <Card corner={tone}>
      <CardKicker tone={tone}>{kicker}</CardKicker>
      {/* mono 36/600/-2% (34 en mobile) — el escalón "número grande" de la escala, no font-heading. */}
      <span className="mt-[5px] font-mono text-stat font-semibold tracking-[-0.02em]">{value}</span>
      {meta && <CardMeta>{meta}</CardMeta>}
      {linkHref && linkLabel && (
        <LinkBtn href={linkHref} variant="ghost" className="self-start mt-1">
          {linkLabel} →
        </LinkBtn>
      )}
    </Card>
  );
  if (!href) return card;
  return (
    <Link href={href} className="block text-inherit no-underline transition-transform hover:-translate-y-0.5">
      {card}
    </Link>
  );
}
