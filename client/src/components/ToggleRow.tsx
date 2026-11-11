export interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A labelled on/off switch row (Settings). */
export function ToggleRow({ label, description, checked, onChange, disabled = false }: ToggleRowProps) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</span>
        {description && <span className="block text-xs text-gray-500 dark:text-gray-400">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 ${checked ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </span>
    </label>
  );
}
