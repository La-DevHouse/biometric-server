import type { ReactNode } from "react";
import { Card, CardKicker, CardMeta } from "./Card";
import { LinkBtn } from "./Btn";

export function StatCard({
  kicker,
  value,
  meta,
  tone = "accent",
  linkHref,
  linkLabel,
}: {
  kicker: string;
  value: ReactNode;
  meta?: ReactNode;
  /** Color del kicker y de las marcas de esquina — cada métrica tiene el suyo, no es un solo acento fijo para toda la grilla. */
  tone?: "accent" | "accent2";
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <Card corner={tone}>
      <CardKicker tone={tone}>{kicker}</CardKicker>
      {/* mono 32/600/-2% — el escalón "número grande" de la escala tipográfica, no font-heading. */}
      <span className="font-mono text-[32px] font-semibold leading-none tracking-tight">{value}</span>
      {meta && <CardMeta>{meta}</CardMeta>}
      {linkHref && linkLabel && (
        <LinkBtn href={linkHref} variant="ghost" className="self-start mt-1">
          {linkLabel} →
        </LinkBtn>
      )}
    </Card>
  );
}
