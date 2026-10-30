/**
 * IANA time zone text input with suggestions from the browser's zone list.
 * Invalid zones are flagged inline; the caller decides whether to save.
 */

import { useId, useMemo } from 'react';
import { isValidTimeZone } from 'wwp-shared';

function supportedZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

interface TimezoneInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}

export function TimezoneInput({ id, value, onChange, className = 'input', ...rest }: TimezoneInputProps) {
  const listId = useId();
  const zones = useMemo(supportedZones, []);
  const invalid = value.trim() !== '' && !isValidTimeZone(value.trim());
  return (
    <>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        aria-label={rest['aria-label']}
        className={`${className} ${invalid ? 'border-red-400 dark:border-red-600' : ''}`}
      />
      <datalist id={listId}>
        {zones.map((z) => <option key={z} value={z} />)}
      </datalist>
      {invalid && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">Not a known time zone</p>}
    </>
  );
}
