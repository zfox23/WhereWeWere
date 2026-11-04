import { useRef, useState } from 'react';
import { ImageIcon, Images, Loader2, Trash2, Upload } from 'lucide-react';
import { APPEARANCE_SPEC } from 'wwp-shared';
import { immich as immichApi, settings as settingsApi } from '../../../api/client';
import { useTheme } from '../../../contexts/ThemeContext';
import { CheckinPhotoPicker } from './CheckinPhotoPicker';
import { prepareWallpaper } from './wallpaperImage';

/** Point the wallpaper layer at a fresh URL so a replaced image shows at once. */
function bustWallpaperCache(): string {
  const url = `${settingsApi.wallpaperUrl}?v=${Date.now()}`;
  document.documentElement.style.setProperty('--app-wallpaper-url', `url("${url}")`);
  return url;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, unit, disabled, onChange }: SliderProps) {
  return (
    <label className={`block space-y-1 ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex justify-between text-xs font-medium text-gray-700 dark:text-gray-300">
        {label}
        <span className="tabular-nums text-gray-500 dark:text-gray-400">{value}{unit}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary-600"
      />
    </label>
  );
}

export function WallpaperControls() {
  const { appearance, setAppearance } = useTheme();
  // null until the preview image has loaded or failed.
  const [hasImage, setHasImage] = useState<boolean | null>(null);
  const [previewUrl, setPreviewUrl] = useState(settingsApi.wallpaperUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (image: Blob) => {
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareWallpaper(image);
      await settingsApi.uploadWallpaper(prepared);
      setPreviewUrl(bustWallpaperCache());
      setHasImage(true);
      setAppearance({ wallpaper: 'on' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save the wallpaper.');
    } finally {
      setBusy(false);
    }
  };

  const pickCheckinPhoto = async (assetId: string) => {
    setPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(immichApi.thumbnailUrl(assetId, 'preview'));
      if (!res.ok) throw new Error('Couldn’t fetch that photo from Immich.');
      const blob = await res.blob();
      setBusy(false);
      await upload(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t fetch that photo.');
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await settingsApi.deleteWallpaper();
      setAppearance({ wallpaper: 'off' });
      setHasImage(false);
      bustWallpaperCache();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t remove the wallpaper.');
    } finally {
      setBusy(false);
    }
  };

  const showing = appearance.wallpaper === 'on' && hasImage !== false;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Photo wallpaper</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          One of your photos behind everything, softened by the theme.
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-gray-100 dark:bg-gray-800 sm:w-44">
          <img
            key={previewUrl}
            src={previewUrl}
            alt="Current wallpaper"
            className={`h-full w-full object-cover ${hasImage ? '' : 'hidden'}`}
            onLoad={() => setHasImage(true)}
            onError={() => setHasImage(false)}
          />
          {hasImage === false && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-gray-400">
              <ImageIcon size={20} />
              No wallpaper yet
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-gray-900/60">
              <Loader2 size={20} className="animate-spin text-primary-600" />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary gap-1.5 text-xs" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload size={14} /> Upload
            </button>
            <button type="button" className="btn-secondary gap-1.5 text-xs" disabled={busy} onClick={() => setPickerOpen(true)}>
              <Images size={14} /> From check-ins
            </button>
            {hasImage && (
              <button type="button" className="btn-secondary gap-1.5 text-xs" disabled={busy} onClick={() => void remove()}>
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
          {hasImage && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={appearance.wallpaper === 'on'}
                onChange={(e) => setAppearance({ wallpaper: e.target.checked ? 'on' : 'off' })}
                className="accent-primary-600"
              />
              Show wallpaper
            </label>
          )}
          <label className={`flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 ${showing ? '' : 'opacity-50'}`}>
            <input
              type="checkbox"
              disabled={!showing}
              checked={appearance.wallpaperTint === 'on'}
              onChange={(e) => setAppearance({ wallpaperTint: e.target.checked ? 'on' : 'off' })}
              className="accent-primary-600"
            />
            Tint with theme color
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Slider
          label="Blur"
          value={appearance.wallpaperBlur}
          min={APPEARANCE_SPEC.wallpaperBlur.min}
          max={APPEARANCE_SPEC.wallpaperBlur.max}
          unit="px"
          disabled={!showing}
          onChange={(wallpaperBlur) => setAppearance({ wallpaperBlur })}
        />
        <Slider
          label="Theme wash"
          value={appearance.wallpaperDim}
          min={APPEARANCE_SPEC.wallpaperDim.min}
          max={APPEARANCE_SPEC.wallpaperDim.max}
          unit="%"
          disabled={!showing}
          onChange={(wallpaperDim) => setAppearance({ wallpaperDim })}
        />
      </div>

      {pickerOpen && <CheckinPhotoPicker onPick={(id) => void pickCheckinPhoto(id)} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
