import type { ReactNode } from 'react';
import PluginTypeToggle from './PluginTypeToggle';

export interface PluginFilterShellProps {
  /** Icon element (e.g. `<Smile size={16} className="text-green-500" />`). */
  icon: ReactNode;
  /** Display name of the plugin type (used by the include toggle). */
  label: string;
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  onToggleIncluded: () => void;
  /** Per-plugin filter controls; rendered only when the type is included. */
  children?: ReactNode;
}

/**
 * Shared visual chrome for a check-in plugin's Home timeline filter section.
 *
 * Every plugin (custom `filterSection` or the framework default) renders its
 * controls inside this shell so all filter cards look identical: one neutral
 * container, the shared include toggle, the same disabled-state hint, and the
 * same spacing. Plugins provide only their own controls as children.
 */
export default function PluginFilterShell({
  icon,
  label,
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  onToggleIncluded,
  children,
}: PluginFilterShellProps) {
  return (
    <div
      className={`rounded-xl border space-y-3 p-3 ${
        filtersDisabled
          ? 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-60'
          : 'border-gray-200 dark:border-gray-700 bg-white/40 dark:bg-gray-900/40'
      }`}
    >
      <PluginTypeToggle
        icon={icon}
        label={label}
        included={included}
        disabled={typeToggleDisabled}
        onToggle={onToggleIncluded}
      />
      {included && filtersDisabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Clear other type filters to enable this type's filtering.
        </p>
      )}
      {included && <div className="space-y-3">{children}</div>}
    </div>
  );
}
