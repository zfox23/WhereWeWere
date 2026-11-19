import { Children } from 'react';
import type { ReactNode } from 'react';

export interface PluginFilterShellProps {
  /** Icon element (e.g. `<Smile size={16} className="text-green-500" />`). */
  icon: ReactNode;
  /** Display name of the plugin type. */
  label: string;
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  onToggleIncluded: () => void;
  /** Per-plugin refinement controls. */
  children?: ReactNode;
}

/**
 * Shared layout for a check-in plugin's Home timeline refinements.
 *
 * The type include toggle now lives in the Filters panel's chip row, and a
 * type's refinements are only rendered while it is the single selected type,
 * so this shell only lays out the plugin's own controls in one compact,
 * wrapping row. The remaining props are kept so existing plugin filter
 * sections keep compiling unchanged.
 */
export default function PluginFilterShell({ included, children }: PluginFilterShellProps) {
  if (!included || Children.toArray(children).length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 [&>*]:min-w-48 [&>*]:flex-1">
      {children}
    </div>
  );
}
