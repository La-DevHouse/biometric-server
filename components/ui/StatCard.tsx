import type { ReactNode } from "react";
import { Card, CardKicker, CardMeta } from "./Card";
import { LinkBtn } from "./Btn";

export function StatCard({
  kicker,
  value,
  meta,
  linkHref,
  linkLabel,
}: {
  kicker: string;
  value: ReactNode;
  meta?: ReactNode;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <Card blueprint>
      <CardKicker>{kicker}</CardKicker>
      <span className="font-heading text-[34px] leading-none">{value}</span>
      {meta && <CardMeta>{meta}</CardMeta>}
      {linkHref && linkLabel && (
        <LinkBtn href={linkHref} variant="ghost" className="self-start mt-1">
          {linkLabel} →
        </LinkBtn>
      )}
    </Card>
  );
}
