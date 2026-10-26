/**
 * "I'm hearing this song": write down a play by hand (music playing out in the
 * world, off a device that doesn't scrobble) so the moment can anchor other
 * check-ins around it.
 *
 * Artist and song autocomplete from the user's own plays first, then Deezer.
 * Picking a suggestion, or typing a song the lookup recognises exactly, fills
 * the album and length into fields that stay editable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MapPin, Music } from 'lucide-react';
import type { CheckInFormProps } from 'wwp-shared';
import CompanionChipInput from '../../../client/src/components/CompanionChipInput';
import { deviceTimezone, localDatetimeToIso, nowLocalDatetimeValue } from '../../../client/src/utils/slugify';
import { usePageTitle } from '../../../client/src/utils/pageTitle';
import { music, NearDuplicateError } from './api';
import { formatClock, formatLength, parseLength } from './format';
import { playPath } from './listTitle';
import { utcToZonedLocalValue, zonedLocalToIso } from './zoned';
import type { NearDuplicate, SongSuggestion } from './types';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Does this suggestion name exactly the song typed? */
function isSameSong(s: SongSuggestion, artist: string, title: string): boolean {
  const a = norm(artist);
  const sa = norm(s.artists.join(' '));
  return norm(s.title) === norm(title) && a !== '' && (sa === a || sa.includes(a) || a.includes(sa));
}

const SUGGEST_DEBOUNCE_MS = 250;
const LOCATION_TIMEOUT_MS = 8000;

type Field = 'artist' | 'title';

function useSuggestions(artist: string, title: string) {
  const [state, setState] = useState<{ suggestions: SongSuggestion[]; catalogUnavailable: boolean; loading: boolean }>({
    suggestions: [], catalogUnavailable: false, loading: false,
  });
  useEffect(() => {
    if (`${artist}${title}`.trim().length < 2) {
      setState({ suggestions: [], catalogUnavailable: false, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      music
        .suggest(artist, title)
        .then((r) => !cancelled && setState({ suggestions: r.suggestions, catalogUnavailable: r.catalog_unavailable, loading: false }))
        .catch(() => !cancelled && setState({ suggestions: [], catalogUnavailable: true, loading: false }));
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [artist, title]);
  return state;
}

function SuggestionList({
  id, suggestions, highlight, onPick, onHover,
}: {
  id: string;
  suggestions: SongSuggestion[];
  highlight: number;
  onPick: (s: SongSuggestion) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      {suggestions.map((s, i) => (
        <li
          key={`${s.source}-${s.title}-${s.artists.join(',')}-${i}`}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === highlight}
          // mousedown, so the pick lands before the input loses focus and closes the list
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(s);
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === highlight ? 'bg-pink-50 dark:bg-pink-900/20' : ''}`}
        >
          {s.cover_url ? (
            <img src={s.cover_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400 dark:bg-gray-800">
              <Music size={14} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{s.title}</span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              {[s.artists.join(', '), s.album, formatLength(s.length)].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
            {s.source === 'library' ? `Yours${s.plays ? ` · ${s.plays}x` : ''}` : 'Deezer'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function MusicCheckInForm({ editId, dateParam, onCreated }: CheckInFormProps) {
  const isEdit = Boolean(editId);
  usePageTitle(isEdit ? 'Edit song' : 'Music check-in');
  const navigate = useNavigate();

  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  // The artist list of a picked suggestion, kept so "Tyler, The Creator" isn't split on its comma.
  const [pickedArtists, setPickedArtists] = useState<string[] | null>(null);
  const [album, setAlbum] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [length, setLength] = useState('');
  const [when, setWhen] = useState(() => (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? `${dateParam}T12:00` : nowLocalDatetimeValue()));
  const [note, setNote] = useState('');
  const [companions, setCompanions] = useState<string[]>([]);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  const [focus, setFocus] = useState<Field | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const { suggestions, catalogUnavailable, loading: suggesting } = useSuggestions(artist, title);
  // Editing keeps what the play already says; a lookup never overwrites it.
  const albumTouched = useRef(isEdit);
  // The timezone the time is read in: the device's for a new song, the play's own when editing.
  const [zone, setZone] = useState(deviceTimezone);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const [savedLocation, setSavedLocation] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(null);
  const [keepLocation, setKeepLocation] = useState(true);

  const [attachLocation, setAttachLocation] = useState(() => !isEdit && typeof navigator !== 'undefined' && 'geolocation' in navigator);
  const [coords, setCoords] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<NearDuplicate | null>(null);

  // Editing: load the play and fill every field from it.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoadingEdit(true);
    music
      .scrobble(editId)
      .then((p) => {
        if (cancelled) return;
        setArtist(p.artists.join(', '));
        setPickedArtists(p.artists);
        setTitle(p.title);
        setAlbum(p.album ?? '');
        setAlbumArtist(p.album_artists[0] ?? '');
        setLength(formatLength(p.track_length));
        setZone(p.timezone);
        setWhen(utcToZonedLocalValue(p.played_at, p.timezone));
        setNote(p.note ?? '');
        setCompanions(p.companions);
        setSavedLocation(p.latitude !== null && p.longitude !== null ? { lat: p.latitude, lon: p.longitude, accuracy: p.location_accuracy } : null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load this play.'))
      .finally(() => !cancelled && setLoadingEdit(false));
    return () => {
      cancelled = true;
    };
  }, [editId]);

  // Ask for the device's location once (coarse is fine), while it is wanted.
  useEffect(() => {
    if (!attachLocation) {
      setCoords(null);
      setLocationNote(null);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationNote('This device can’t share a location.');
      return;
    }
    let cancelled = false;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null });
        setLocationNote(null);
        setLocating(false);
      },
      () => {
        if (cancelled) return;
        setCoords(null);
        setLocationNote('Location unavailable; saving without it.');
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: 5 * 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [attachLocation]);

  // Fill the album and length once the lookup recognises exactly this song.
  useEffect(() => {
    if (!artist.trim() || !title.trim() || albumTouched.current) return;
    const match = suggestions.find((s) => isSameSong(s, artist, title));
    if (!match) return;
    if (!album && match.album) setAlbum(match.album);
    if (!albumArtist && match.album_artist) setAlbumArtist(match.album_artist);
    if (!length && match.length) setLength(formatLength(match.length));
    if (match.album || match.length) setFilledFrom(match.source === 'library' ? 'your plays' : 'Deezer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  const open = focus !== null && suggestions.length > 0;

  const pick = (s: SongSuggestion) => {
    setArtist(s.artists.join(', '));
    setPickedArtists(s.artists);
    setTitle(s.title);
    setAlbum(s.album ?? '');
    setAlbumArtist(s.album_artist ?? '');
    setLength(formatLength(s.length));
    albumTouched.current = false;
    setFilledFrom(s.source === 'library' ? 'your plays' : 'Deezer');
    setFocus(null);
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setFocus(null);
    }
  };

  const lengthSeconds = parseLength(length);
  const lengthInvalid = length.trim() !== '' && lengthSeconds === null;
  const playedAtIso = isEdit ? zonedLocalToIso(when, zone) : localDatetimeToIso(when);
  const canSave = artist.trim() !== '' && title.trim() !== '' && !lengthInvalid && !!playedAtIso && !submitting && !loadingEdit;
  const zoneLabel = useMemo(() => {
    const d = new Date(playedAtIso ?? Date.now());
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? zone;
  }, [playedAtIso, zone]);

  const save = async (force: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const artists = pickedArtists && pickedArtists.join(', ') === artist.trim() ? pickedArtists : [artist.trim()];
      const fields = {
        title: title.trim(),
        artists,
        album: album.trim() || null,
        album_artists: albumArtist.trim() ? [albumArtist.trim()] : [],
        track_length: lengthSeconds,
        played_at: playedAtIso as string,
        timezone: zone,
        note: note.trim() || null,
        companions,
        // New: the device's position if wanted. Editing: the saved one, kept or dropped.
        ...(isEdit
          ? {
              latitude: keepLocation && savedLocation ? savedLocation.lat : null,
              longitude: keepLocation && savedLocation ? savedLocation.lon : null,
              location_accuracy: keepLocation && savedLocation ? savedLocation.accuracy : null,
            }
          : {
              latitude: attachLocation && coords ? Number(coords.lat.toFixed(5)) : null,
              longitude: attachLocation && coords ? Number(coords.lon.toFixed(5)) : null,
              location_accuracy: attachLocation && coords ? coords.accuracy : null,
            }),
      };
      if (editId) {
        await music.updateScrobble(editId, fields);
        navigate(playPath(editId));
        return;
      }
      const created = await music.createScrobble({ ...fields, force });
      onCreated(created.session_id ?? created.id);
    } catch (err) {
      if (err instanceof NearDuplicateError) setDuplicate(err.duplicate);
      else setError(err instanceof Error ? err.message : 'Could not save the song.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldProps = (field: Field, listId: string) => ({
    role: 'combobox' as const,
    'aria-expanded': open && focus === field,
    'aria-controls': listId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': open && focus === field && highlight >= 0 ? `${listId}-${highlight}` : undefined,
    autoComplete: 'off',
    onFocus: () => {
      setFocus(field);
      setHighlight(-1);
    },
    onBlur: () => setFocus((f) => (f === field ? null : f)),
    onKeyDown,
  });

  if (loadingEdit) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-3 pb-28">
      <div className="flex items-center gap-3 text-gray-900 dark:text-gray-100">
        <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{isEdit ? 'Edit song' : 'What are you listening to?'}</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save(false);
        }}
        className="flex flex-col gap-4 rounded-2xl border border-white/40 bg-white/60 p-4 dark:border-gray-700/40 dark:bg-gray-900/60"
      >
        <div className="relative space-y-1.5">
          <label htmlFor="music-artist" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Artist</label>
          <input
            id="music-artist"
            type="text"
            value={artist}
            onChange={(e) => {
              setArtist(e.target.value);
              setPickedArtists(null);
            }}
            className="input w-full"
            placeholder="Who is playing?"
            {...fieldProps('artist', 'music-artist-list')}
          />
          {open && focus === 'artist' && (
            <SuggestionList id="music-artist-list" suggestions={suggestions} highlight={highlight} onPick={pick} onHover={setHighlight} />
          )}
        </div>

        <div className="relative space-y-1.5">
          <label htmlFor="music-title" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Song</label>
          <input
            id="music-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input w-full"
            placeholder="What song?"
            {...fieldProps('title', 'music-title-list')}
          />
          {open && focus === 'title' && (
            <SuggestionList id="music-title-list" suggestions={suggestions} highlight={highlight} onPick={pick} onHover={setHighlight} />
          )}
          {suggesting && <Loader2 size={14} className="absolute right-3 top-9 animate-spin text-primary-500" aria-label="Looking up" />}
          {catalogUnavailable && focus && (
            <p className="text-xs text-gray-400">Online lookup is unavailable; showing your own songs.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="music-album" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Album</label>
            <input
              id="music-album"
              type="text"
              value={album}
              onChange={(e) => {
                albumTouched.current = true;
                setAlbum(e.target.value);
              }}
              className="input w-full"
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="music-album-artist" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Album artist</label>
            <input
              id="music-album-artist"
              type="text"
              value={albumArtist}
              onChange={(e) => {
                albumTouched.current = true;
                setAlbumArtist(e.target.value);
              }}
              className="input w-full"
              placeholder="Defaults to the artist"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="music-length" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Length</label>
            <input
              id="music-length"
              type="text"
              inputMode="numeric"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              aria-invalid={lengthInvalid}
              className={`input w-full ${lengthInvalid ? 'border-red-400' : ''}`}
              placeholder="m:ss"
            />
            {lengthInvalid && <p className="text-xs text-red-500">Use minutes and seconds, like 3:21.</p>}
          </div>
        </div>
        {filledFrom && <p className="-mt-2 text-xs text-gray-400">Filled in from {filledFrom}. Change anything that’s wrong.</p>}

        <div className="space-y-1.5">
          <label htmlFor="music-when" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
            When <span className="font-normal text-gray-400">({zoneLabel})</span>
          </label>
          <input id="music-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input w-full text-gray-900 dark:text-gray-100" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="music-note" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Note</label>
          <textarea id="music-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="input w-full" placeholder="Where were you? What was happening?" />
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Here with</span>
          <CompanionChipInput value={companions} onChange={setCompanions} />
        </div>

        {isEdit ? (
          savedLocation && (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={keepLocation} onChange={(e) => setKeepLocation(e.target.checked)} className="mt-0.5" />
              <span className="flex items-center gap-1.5 font-medium">
                <MapPin size={14} className="text-pink-500" />
                Keep the saved location
              </span>
            </label>
          )
        ) : (
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={attachLocation} onChange={(e) => setAttachLocation(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <MapPin size={14} className="text-pink-500" />
                Attach my location
                {locating && <Loader2 size={12} className="animate-spin" aria-label="Finding your location" />}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {coords
                  ? `Found you${coords.accuracy ? ` (within about ${coords.accuracy} m)` : ''}.`
                  : locationNote ?? 'Uses this device’s approximate position.'}
              </span>
            </span>
          </label>
        )}

        {duplicate && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <p>
              You already have “{duplicate.title}” at {formatClock(duplicate.played_at)}
              {duplicate.source === 'manual' ? ' (written down by hand)' : duplicate.source ? ` (from ${duplicate.source})` : ''}.
              Is this a separate listen?
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => void save(true)} disabled={submitting} className="btn-primary !py-1 text-xs">Add it anyway</button>
              <button type="button" onClick={() => setDuplicate(null)} className="btn-secondary !py-1 text-xs">Cancel</button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={!canSave} className="btn-primary flex items-center justify-center gap-2">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Music size={16} />}
          {isEdit ? 'Save changes' : 'Save'}
        </button>
      </form>
    </div>
  );
}
