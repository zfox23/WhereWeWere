import type { CSSProperties } from 'react';
import { Square } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  BLUR_OPTIONS,
  RADIUS_OPTIONS,
  SHADOW_OPTIONS,
  SURFACE_OPTIONS,
  labelFor,
} from '../../../appearance';
import { DisplaySection } from './DisplaySection';
import { OptionPicker } from './OptionPicker';

// Fixed preview styles (the live result shows in the preview strip above).
const RADIUS_PX: Record<string, number> = { sharp: 3, subtle: 8, default: 14, pillowy: 22 };
const BLUR_PX: Record<string, number> = { off: 0, light: 2, default: 4, heavy: 7 };
const SHADOW_CSS: Record<string, string> = {
  flat: 'none',
  soft: '0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  lifted: '0 8px 18px -4px rgb(0 0 0 / 0.2), 0 3px 6px -3px rgb(0 0 0 / 0.12)',
};
const SURFACE_CSS: Record<string, CSSProperties> = {
  frosted: { backgroundColor: 'rgb(255 255 255 / 0.55)', border: '1px solid rgb(255 255 255 / 0.6)', backdropFilter: 'blur(4px)' },
  solid: { backgroundColor: 'rgb(255 255 255)', border: '1px solid rgb(0 0 0 / 0.06)' },
  outlined: { backgroundColor: 'rgb(255 255 255 / 0.15)', border: '1px solid rgb(0 0 0 / 0.25)' },
  paper: { backgroundColor: 'rgb(253 248 238)', border: '1px solid rgb(0 0 0 / 0.08)', boxShadow: '0 2px 5px -2px rgb(60 40 20 / 0.3)' },
  luminous: { backgroundColor: 'rgb(255 255 255 / 0.7)', border: '1.5px solid rgb(var(--color-primary-400))', boxShadow: '0 0 10px rgb(var(--color-primary-500) / 0.45)', backdropFilter: 'blur(6px)' },
  tinted: { backgroundColor: 'rgb(var(--color-primary-100) / 0.65)', border: '1px solid rgb(var(--color-primary-300) / 0.7)', backdropFilter: 'blur(6px)' },
};

const previewBackdrop: CSSProperties = {
  backgroundImage: 'linear-gradient(135deg, rgb(var(--color-primary-300)), rgb(var(--color-primary-600)))',
};

export function SurfacesSection() {
  const { appearance, setAppearance } = useTheme();

  return (
    <DisplaySection
      id="surfaces"
      title="Shape & Surfaces"
      icon={Square}
      summary={`${labelFor(SURFACE_OPTIONS, appearance.surface)} · ${labelFor(RADIUS_OPTIONS, appearance.radius)}`}
    >
      <OptionPicker
        label="Surface style"
        hint="How cards and panels sit on the background."
        options={SURFACE_OPTIONS}
        value={appearance.surface}
        onChange={(surface) => setAppearance({ surface })}
        columns={2}
        renderPreview={(option) => (
          <div className="relative h-10 w-full overflow-hidden rounded-lg" style={previewBackdrop} aria-hidden="true">
            <div className="absolute inset-x-3 inset-y-2 rounded-md" style={SURFACE_CSS[option.id]} />
          </div>
        )}
      />

      <OptionPicker
        label="Corner roundness"
        options={RADIUS_OPTIONS}
        value={appearance.radius}
        onChange={(radius) => setAppearance({ radius })}
        renderPreview={(option) => (
          <div
            className="h-8 w-12 border-2 border-primary-500 bg-primary-100/60 dark:bg-primary-900/40"
            style={{ borderRadius: RADIUS_PX[option.id] }}
            aria-hidden="true"
          />
        )}
      />

      <OptionPicker
        label="Glass blur"
        hint="How much frosted panels blur what's behind them."
        options={BLUR_OPTIONS}
        value={appearance.blur}
        onChange={(blur) => setAppearance({ blur })}
        renderPreview={(option) => (
          <div className="relative h-8 w-full overflow-hidden rounded-md" style={previewBackdrop} aria-hidden="true">
            <span className="absolute left-1.5 top-1 font-display text-lg leading-none text-white">WWW</span>
            <div
              className="absolute inset-y-0 right-0 w-3/5 bg-white/40"
              style={{ backdropFilter: `blur(${BLUR_PX[option.id]}px)` }}
            />
          </div>
        )}
      />

      <OptionPicker
        label="Shadow depth"
        options={SHADOW_OPTIONS}
        value={appearance.shadow}
        onChange={(shadow) => setAppearance({ shadow })}
        renderPreview={(option) => (
          <div className="flex h-10 w-full items-center justify-center" aria-hidden="true">
            <div className="h-6 w-10 rounded-md bg-white dark:bg-gray-700" style={{ boxShadow: SHADOW_CSS[option.id] }} />
          </div>
        )}
      />
    </DisplaySection>
  );
}
