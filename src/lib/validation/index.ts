/** Shared validation schemas and input guards (Extended across Phases 1–16). */
export function isNonEmptyText(value: string): boolean {
  return value.trim().length > 0;
}
