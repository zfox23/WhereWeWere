import { Accessibility } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { DisplaySection } from './DisplaySection';

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
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

export function AccessibilitySection() {
  const { appearance, setAppearance } = useTheme();
  const active = [
    appearance.reduceTransparency === 'on' && 'Less transparency',
    appearance.reduceMotion === 'on' && 'Less motion',
  ].filter(Boolean);

  return (
    <DisplaySection
      id="accessibility"
      title="Comfort"
      icon={Accessibility}
      summary={active.length > 0 ? active.join(' · ') : undefined}
      defaultOpen={false}
    >
      <ToggleRow
        label="Reduce transparency"
        description="Opaque panels with no background blur, whatever the surface style. Easier to read and lighter on older devices."
        checked={appearance.reduceTransparency === 'on'}
        onChange={(on) => setAppearance({ reduceTransparency: on ? 'on' : 'off' })}
      />
      <ToggleRow
        label="Reduce motion"
        description="Stop animations and drifting backgrounds. Already automatic when your device asks for reduced motion."
        checked={appearance.reduceMotion === 'on'}
        onChange={(on) => setAppearance({ reduceMotion: on ? 'on' : 'system' })}
      />
    </DisplaySection>
  );
}
