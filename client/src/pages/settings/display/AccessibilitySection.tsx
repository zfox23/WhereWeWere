import { Accessibility } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { DisplaySection } from './DisplaySection';
import { ToggleRow } from '../../../components/ToggleRow';

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
