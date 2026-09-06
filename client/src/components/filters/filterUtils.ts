/**
 * Find an option that exactly matches the given value (case-insensitive, trimmed).
 * Returns null if the value is empty or has no exact match.
 */
export function findExactOption(value: string, options: string[]): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return options.find((opt) => opt.toLowerCase() === normalized) || null;
}
