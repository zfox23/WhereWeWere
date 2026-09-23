/**
 * Plugin field schema — the shared "shape of data" language used by both the
 * server (validation, generic storage, backup/restore) and the client
 * (auto-generated check-in form and timeline card).
 *
 * A plugin's `fields` array fully describes the data stored with each
 * check-in. If a plugin does not ship its own UI, the framework renders a
 * check-in form and a timeline card purely from this schema.
 */

/**
 * The set of field kinds the framework understands.
 *
 * Each kind maps to a default input in the auto-generated form and a default
 * value display in the auto-generated card:
 *  - text / textarea / number / integer / boolean / date / datetime:
 *    direct form controls.
 *  - rating: integer 0..max with stars (default max 5).
 *  - select: single choice from `options`.
 *  - multi-select: any number of choices from `options`.
 */
export type PluginFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'rating'
  | 'select'
  | 'multi-select';

export interface PluginFieldOption {
  /** The value stored with the check-in. */
  value: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Optional lucide icon name or emoji, rendered in pickers. */
  icon?: string | null;
}

export interface PluginField {
  /**
   * Machine-safe key used in the stored data object (snake_case or
   * camelCase). Must be unique within a plugin.
   */
  name: string;
  kind: PluginFieldKind;
  /** Human-readable label (shown in the auto form and auto card). */
  label: string;
  required?: boolean;
  /** Placeholder / hint for the auto form. */
  placeholder?: string;
  /** Default value used by the auto form. */
  default?: unknown;

  // number / integer / rating
  min?: number;
  max?: number;
  step?: number;
  /** Suffix rendered after the value, e.g. "km", "min". */
  unit?: string;

  // select / multi-select / rating
  options?: PluginFieldOption[];

  // date / datetime
  /** True when the field value is authoritative for the check-in timestamp. */
  isTimestamp?: boolean;
}

/**
 * Runtime validation of a data object against a plugin's field schema.
 * Returns a list of human-readable error strings; empty means valid.
 *
 * This is a shared implementation so the server can reuse it verbatim, but
 * it is intentionally dependency-free.
 */
export function validatePluginData(
  fields: PluginField[],
  data: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const field of fields) {
    const value = data[field.name];
    const missing = value === undefined || value === null || value === '';

    if (missing) {
      if (field.required) {
        errors.push(`${field.label} is required`);
      }
      continue;
    }

    switch (field.kind) {
      case 'text':
      case 'textarea':
        if (typeof value !== 'string') {
          errors.push(`${field.label} must be a string`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${field.label} must be a number`);
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push(`${field.label} must be at least ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            errors.push(`${field.label} must be at most ${field.max}`);
          }
        }
        break;
      case 'integer':
      case 'rating':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`${field.label} must be a whole number`);
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push(`${field.label} must be at least ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            errors.push(`${field.label} must be at most ${field.max}`);
          }
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${field.label} must be a boolean`);
        }
        break;
      case 'date':
      case 'datetime':
        if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
          errors.push(`${field.label} must be a valid ${field.kind}`);
        }
        break;
      case 'select': {
        if (typeof value !== 'string') {
          errors.push(`${field.label} must be a string`);
          break;
        }
        if (field.options && !field.options.some((o) => o.value === value)) {
          errors.push(`${field.label} has an invalid option`);
        }
        break;
      }
      case 'multi-select': {
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          errors.push(`${field.label} must be an array of strings`);
          break;
        }
        if (field.options) {
          for (const v of value as string[]) {
            if (!field.options.some((o) => o.value === v)) {
              errors.push(`${field.label} has an invalid option`);
              break;
            }
          }
        }
        break;
      }
    }
  }

  return errors;
}
