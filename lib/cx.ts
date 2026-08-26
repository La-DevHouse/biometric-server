/** Joins class name fragments, dropping falsy ones. No cva/clsx dependency needed for this project's scale. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
