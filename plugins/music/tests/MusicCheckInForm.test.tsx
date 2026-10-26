import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicCheckInForm from '../ui/MusicCheckInForm';

const suggestMock = vi.fn();
const createMock = vi.fn();
const scrobbleMock = vi.fn();
const updateMock = vi.fn();
vi.mock('../ui/api', () => {
  class NearDuplicateError extends Error {
    constructor(readonly duplicate: unknown) {
      super('dup');
    }
  }
  return {
    NearDuplicateError,
    music: {
      suggest: (...a: unknown[]) => suggestMock(...a),
      createScrobble: (...a: unknown[]) => createMock(...a),
      scrobble: (...a: unknown[]) => scrobbleMock(...a),
      updateScrobble: (...a: unknown[]) => updateMock(...a),
    },
  };
});
vi.mock('../../../client/src/components/CompanionChipInput', () => ({
  default: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, 'Sam'])}>add companion ({value.join(',')})</button>
  ),
}));
vi.mock('../../../client/src/utils/pageTitle', () => ({ usePageTitle: () => {} }));

const lib = { source: 'library', title: 'Sun & Moon', artists: ['Above & Beyond'], album: 'Group Therapy', album_artist: 'Above & Beyond', length: 321, cover_url: null, plays: 12 };
const deezer = { source: 'deezer', title: 'Sun Is Shining', artists: ['Bob Marley'], album: 'Exodus', album_artist: 'Bob Marley', length: 270, cover_url: 'https://cdn/c.jpg', plays: null };

const geo = { getCurrentPosition: vi.fn() };
function renderForm(props: Partial<React.ComponentProps<typeof MusicCheckInForm>> = {}) {
  const onCreated = vi.fn();
  render(
    <MemoryRouter>
      <MusicCheckInForm onCreated={onCreated} onUpdated={() => {}} {...props} />
    </MemoryRouter>,
  );
  return { onCreated };
}

describe('MusicCheckInForm', () => {
  beforeEach(() => {
    suggestMock.mockResolvedValue({ suggestions: [], catalog_unavailable: false });
    createMock.mockResolvedValue({ id: 'scrobble-1', session_id: 'session-1' });
    geo.getCurrentPosition.mockImplementation((ok: (p: unknown) => void) => ok({ coords: { latitude: 41.878123, longitude: -87.629876, accuracy: 35.4 } }));
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers your songs and the catalog as you type, and fills every field from a pick', async () => {
    const user = userEvent.setup();
    suggestMock.mockResolvedValue({ suggestions: [lib, deezer], catalog_unavailable: false });
    renderForm();
    await user.type(screen.getByLabelText('Song'), 'sun');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Sun & Moon'),
      expect.stringContaining('Sun Is Shining'),
    ]);
    expect(options[0].textContent).toContain('Yours · 12x');
    expect(options[1].textContent).toContain('Deezer');
    expect(suggestMock).toHaveBeenLastCalledWith('', 'sun');

    await user.click(options[1]);
    expect((screen.getByLabelText('Artist') as HTMLInputElement).value).toBe('Bob Marley');
    expect((screen.getByLabelText('Song') as HTMLInputElement).value).toBe('Sun Is Shining');
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Exodus');
    expect((screen.getByLabelText('Length') as HTMLInputElement).value).toBe('4:30');
    expect(screen.getByText(/Filled in from Deezer/)).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks with the keyboard', async () => {
    const user = userEvent.setup();
    suggestMock.mockResolvedValue({ suggestions: [lib, deezer], catalog_unavailable: false });
    renderForm();
    await user.type(screen.getByLabelText('Artist'), 'ab');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    expect((screen.getByLabelText('Song') as HTMLInputElement).value).toBe('Sun & Moon');
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Group Therapy');
  });

  it('fills the album and length once the lookup recognises exactly what was typed, without overwriting edits', async () => {
    const user = userEvent.setup();
    suggestMock.mockResolvedValue({ suggestions: [{ ...lib, source: 'deezer' }], catalog_unavailable: false });
    renderForm();
    await user.type(screen.getByLabelText('Artist'), 'above and beyond');
    await user.type(screen.getByLabelText('Song'), 'Sun & Moon');
    await waitFor(() => expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Group Therapy'));
    expect((screen.getByLabelText('Length') as HTMLInputElement).value).toBe('5:21');
    expect((screen.getByLabelText('Album artist') as HTMLInputElement).value).toBe('Above & Beyond');

    // The user's own edit wins over any later lookup.
    await user.clear(screen.getByLabelText('Album'));
    await user.type(screen.getByLabelText('Album'), 'Live at Red Rocks');
    await user.type(screen.getByLabelText('Song'), ' ');
    await new Promise((r) => setTimeout(r, 350));
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Live at Red Rocks');
  });

  it('does not guess when the lookup only finds a different song', async () => {
    const user = userEvent.setup();
    suggestMock.mockResolvedValue({ suggestions: [deezer], catalog_unavailable: false });
    renderForm();
    await user.type(screen.getByLabelText('Artist'), 'Bob Marley');
    await user.type(screen.getByLabelText('Song'), 'Zimbabwe');
    await new Promise((r) => setTimeout(r, 350));
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('');
  });

  it('says when the online lookup is unavailable', async () => {
    const user = userEvent.setup();
    suggestMock.mockResolvedValue({ suggestions: [lib], catalog_unavailable: true });
    renderForm();
    await user.type(screen.getByLabelText('Song'), 'sun');
    expect(await screen.findByText(/Online lookup is unavailable/)).toBeTruthy();
  });

  it('saves with the time, zone, note, companions and place, then reports the session', async () => {
    const user = userEvent.setup();
    suggestMock.mockResolvedValue({ suggestions: [{ ...lib, artists: ['Tyler, The Creator'], title: 'EARFQUAKE' }], catalog_unavailable: false });
    const { onCreated } = renderForm();
    await user.type(screen.getByLabelText('Song'), 'earf');
    await user.click((await screen.findAllByRole('option'))[0]);
    await user.clear(screen.getByLabelText(/^When/));
    await user.type(screen.getByLabelText(/^When/), '2026-05-01T14:30');
    await user.type(screen.getByLabelText('Note'), '  Heard it at the market ');
    await user.click(screen.getByRole('button', { name: /add companion/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const sent = createMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      title: 'EARFQUAKE',
      artists: ['Tyler, The Creator'], // not split on its comma
      album: 'Group Therapy',
      album_artists: ['Above & Beyond'],
      track_length: 321,
      note: 'Heard it at the market',
      companions: ['Sam'],
      latitude: 41.87812,
      longitude: -87.62988,
      location_accuracy: 35,
      force: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(sent.played_at).toBe(new Date('2026-05-01T14:30').toISOString());
    expect(onCreated).toHaveBeenCalledWith('session-1');
  });

  it('takes typed text as one artist and leaves blank optional fields out', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Artist'), 'Local Band');
    await user.type(screen.getByLabelText('Song'), 'Untitled');
    await user.click(screen.getByLabelText(/Attach my location/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toMatchObject({
      artists: ['Local Band'], album: null, album_artists: [], track_length: null, note: null, companions: [], latitude: null, longitude: null,
    });
  });

  it('needs an artist and a song, and a readable length', async () => {
    const user = userEvent.setup();
    renderForm();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByLabelText('Artist'), 'A');
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByLabelText('Song'), 'B');
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.type(screen.getByLabelText('Length'), 'soon');
    expect(screen.getByText(/minutes and seconds/)).toBeTruthy();
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.clear(screen.getByLabelText('Length'));
    await user.type(screen.getByLabelText('Length'), '201');
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  it('saves without a place when location is refused, and asks for none when switched off', async () => {
    const user = userEvent.setup();
    geo.getCurrentPosition.mockImplementation((_ok: unknown, fail: () => void) => fail());
    renderForm();
    expect(await screen.findByText(/Location unavailable/)).toBeTruthy();
    await user.type(screen.getByLabelText('Artist'), 'A');
    await user.type(screen.getByLabelText('Song'), 'B');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toMatchObject({ latitude: null, longitude: null });
    cleanup();
    geo.getCurrentPosition.mockClear();
    renderForm();
    await user.click(screen.getByLabelText(/Attach my location/));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1); // from mount only
  });

  it('asks before adding a song that is already on file around then', async () => {
    const user = userEvent.setup();
    const { NearDuplicateError } = await import('../ui/api');
    createMock.mockRejectedValueOnce(new NearDuplicateError({ id: 'x', played_at: '2026-05-01T14:28:00Z', title: 'B', artists: ['A'], source: 'multi-scrobbler' }));
    const { onCreated } = renderForm();
    await user.type(screen.getByLabelText('Artist'), 'A');
    await user.type(screen.getByLabelText('Song'), 'B');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/already have “B”.*multi-scrobbler/);
    expect(onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add it anyway' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(createMock.mock.calls[1][0].force).toBe(true);
    expect(onCreated).toHaveBeenCalledWith('session-1');
  });

  it('shows a save failure and stays on the form', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValueOnce(new Error('A song needs a title and an artist'));
    const { onCreated } = renderForm();
    await user.type(screen.getByLabelText('Artist'), 'A');
    await user.type(screen.getByLabelText('Song'), 'B');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A song needs a title and an artist')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('opens on the day it was reached from', () => {
    renderForm({ dateParam: '2026-03-09' });
    expect((screen.getByLabelText(/^When/) as HTMLInputElement).value).toBe('2026-03-09T12:00');
  });
});

describe('MusicCheckInForm: editing a play', () => {
  const PLAY = {
    id: 'p1', played_at: '2024-05-01T20:05:00Z', timezone: 'America/Chicago', title: 'Sun & Moon', artists: ['Tyler, The Creator'],
    album: 'Group Therapy', album_artists: ['Above & Beyond'], track_length: 321, listened_for: null, source: 'multi-scrobbler',
    note: 'old note', latitude: 41.88, longitude: -87.63, location_accuracy: 35, companions: ['Sam'],
  };
  function Probe() {
    return <div data-testid="probe">{useLocation().pathname}</div>;
  }
  function renderEdit() {
    return render(
      <MemoryRouter initialEntries={['/music-check-in?edit=p1']}>
        <Routes>
          <Route path="/music-check-in" element={<MusicCheckInForm editId="p1" onCreated={vi.fn()} onUpdated={() => {}} />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    suggestMock.mockResolvedValue({ suggestions: [], catalog_unavailable: false });
    scrobbleMock.mockResolvedValue(PLAY);
    updateMock.mockResolvedValue({ id: 'p1', session_id: 's1' });
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('fills every field from the play, with the time on the wall clock of the zone it was played in', async () => {
    renderEdit();
    expect(await screen.findByRole('heading', { name: 'Edit song' })).toBeTruthy();
    expect(scrobbleMock).toHaveBeenCalledWith('p1');
    expect((screen.getByLabelText('Artist') as HTMLInputElement).value).toBe('Tyler, The Creator');
    expect((screen.getByLabelText('Song') as HTMLInputElement).value).toBe('Sun & Moon');
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Group Therapy');
    expect((screen.getByLabelText('Album artist') as HTMLInputElement).value).toBe('Above & Beyond');
    expect((screen.getByLabelText('Length') as HTMLInputElement).value).toBe('5:21');
    expect((screen.getByLabelText(/^When/) as HTMLInputElement).value).toBe('2024-05-01T15:05'); // Chicago, not the device
    expect(screen.getByLabelText(/^When/).closest('div')?.textContent).toContain('CDT');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('old note');
    expect(screen.getByRole('button', { name: /add companion \(Sam\)/ })).toBeTruthy();
    // It does not go and ask the device for a position.
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Keep the saved location/)).toBeTruthy();
  });

  it('saves the changes in the play\'s own zone and returns to the play', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit song' });
    await user.clear(screen.getByLabelText('Album'));
    await user.type(screen.getByLabelText('Album'), 'Live');
    await user.clear(screen.getByLabelText(/^When/));
    await user.type(screen.getByLabelText(/^When/), '2024-05-01T15:30');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const [id, sent] = updateMock.mock.calls[0];
    expect(id).toBe('p1');
    expect(sent).toMatchObject({
      title: 'Sun & Moon', artists: ['Tyler, The Creator'], album: 'Live', album_artists: ['Above & Beyond'], track_length: 321,
      timezone: 'America/Chicago', note: 'old note', companions: ['Sam'], latitude: 41.88, longitude: -87.63, location_accuracy: 35,
    });
    expect(sent.played_at).toBe('2024-05-01T20:30:00.000Z'); // 3:30 PM Chicago
    expect(sent).not.toHaveProperty('force');
    expect(createMock).not.toHaveBeenCalled();
    expect((await screen.findByTestId('probe')).textContent).toBe('/music/plays/p1');
  });

  it('drops the saved location when unchecked', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit song' });
    await user.click(screen.getByLabelText(/Keep the saved location/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][1]).toMatchObject({ latitude: null, longitude: null, location_accuracy: null });
  });

  it('has no location option for a play that never had one', async () => {
    scrobbleMock.mockResolvedValue({ ...PLAY, latitude: null, longitude: null, location_accuracy: null });
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit song' });
    expect(screen.queryByLabelText(/location/i)).toBeNull();
  });

  it('does not let a lookup overwrite the album it already has', async () => {
    suggestMock.mockResolvedValue({
      suggestions: [{ source: 'deezer', title: 'Sun & Moon', artists: ['Tyler, The Creator'], album: 'Some Other Album', album_artist: 'X', length: 100, cover_url: null, plays: null }],
      catalog_unavailable: false,
    });
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit song' });
    await new Promise((r) => setTimeout(r, 400));
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Group Therapy');
  });

  it('shows a save failure (such as another play having that time) and stays', async () => {
    const user = userEvent.setup();
    updateMock.mockRejectedValue(new Error('Another play already has that time and song'));
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit song' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Another play already has that time and song')).toBeTruthy();
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('says so when the play can\'t be loaded', async () => {
    scrobbleMock.mockRejectedValue(new Error('No such play'));
    renderEdit();
    expect(await screen.findByText('No such play')).toBeTruthy();
  });
});
