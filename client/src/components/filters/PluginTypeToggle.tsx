import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface PluginTypeToggleProps {
  /** Icon element (e.g. `<Smile size={16} className="text-green-500" />`). */
  icon: ReactNode;
  label: string;
  included: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/**
 * Full-width include toggle for a check-in plugin's filter section.
 * Highlighted (with a check) when the type is included in the timeline.
 */
export default function PluginTypeToggle({
  icon,
  label,
  included,
  disabled,
  onToggle,
}: PluginTypeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        included
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {icon}
      {label}
      {included && <Check size={14} className="ml-auto" />}
    </button>
  );
}
