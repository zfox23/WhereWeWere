import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayPage, { sourceLabel } from '../ui/pages/PlayPage';
import { resetMusicLists } from '../ui/useMusicLists';

const scrobbleMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
  music: {
    scrobble: (...a: unknown[]) => scrobbleMock(...a),
    deleteScrobble: (...a: unknown[]) => deleteMock(...a),
    lists: () => Promise.resolve([]),
    albumView: () => new Promise(() => {}),
  },
}));
const settingsGet = vi.fn();
const photosMock = vi.fn();
vi.mock('../../../client/src/api/client', () => ({
  settings: { get: () => settingsGet() },
  immich: { photosForCheckins: (...a: unknown[]) => photosMock(...a), thumbnailUrl: (id: string) => `/thumb/${id}` },
}));
vi.mock('../../../client/src/utils/pageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../location/ui/MapView', () => ({
  default: ({ center }: { center: [number, number] }) => <div data-testid="map">{center.join(',')}</div>,
}));

const PLAY = {
  id: 'p1', played_at: '2024-05-01T20:05:00Z', timezone: 'America/Chicago', title: 'Sun & Moon', artists: ['Above & Beyond'],
  album: 'Group Therapy', album_artists: ['Above & Beyond'], track_length: 321, listened_for: 200, source: 'manual',
  note: 'At the *farmers* market', latitude: 41.88, longitude: -87.63, location_accuracy: 35, companions: ['Sam', 'Riley'],
  art_id: 'art1', album_ref: 'group therapy|above & beyond', song_key: 'sun & moon\u001fabove & beyond',
  history: { plays: 12, first_played_at: '2023-01-02T00:00:00Z', last_played_at: '2024-05-01T20:05:00Z' },
  session: {
    id: 'sess1', date: '2024-05-01', position: 2, count: 3,
    previous: { id: 'p0', title: 'Before Song', artists: ['X'], played_at: '2024-05-01T20:00:00Z' },
    next: { id: 'p2', title: 'After Song', artists: ['Y'], played_at: '2024-05-01T20:10:00Z' },
  },
};

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}{loc.search}|{JSON.stringify(loc.state)}</div>;
}
function renderPage(path = '/music/plays/p1') {
  return render(
    <MemoryRouter initialEntries={['/earlier', path]} initialIndex={1}>
      <Routes>
        <Route path="/music/plays/:id" element={<PlayPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PlayPage', () => {
  beforeEach(() => {
    resetMusicLists();
    scrobbleMock.mockResolvedValue(PLAY);
    settingsGet.mockResolvedValue({});
    photosMock.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the song, when and how it was recorded, your history, and where it sits in its session', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /Sun & Moon/ })).toBeTruthy();
    expect(scrobbleMock).toHaveBeenCalledWith('p1');
    expect(document.querySelector('img[alt$="cover"]')?.getAttribute('src')).toBe('/art/art1/large');
    expect(screen.getByRole('link', { name: 'Above & Beyond' }).getAttribute('href')).toContain('musicView=artists');
    expect(screen.getByRole('link', { name: 'Group Therapy' })).toBeTruthy();
    expect(screen.getByText(/5:21/)).toBeTruthy(); // length
    // The time is in the zone it was played in, with the abbreviation, like other check-in pages.
    expect(screen.getByText(/3:05 PM CDT/)).toBeTruthy();
    expect(screen.getByText(/Written down by hand · listened for 3:20/)).toBeTruthy();
    expect(screen.getByText('farmers').tagName).toBe('EM'); // the note renders its markdown
    expect(screen.getByText(/With Sam, Riley/)).toBeTruthy();
    expect(screen.getByText(/played this 12 times/)).toBeTruthy();
    expect(screen.getByText(/2nd of 3 in this listening session/)).toBeTruthy();
    expect(screen.getByTestId('map').textContent).toBe('41.88,-87.63');
    expect(screen.getByText(/within about 35 m/)).toBeTruthy();
  });

  it('links to the day, the neighbouring songs, the session on Home and the library', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /Sun & Moon/ });
    expect(screen.getByRole('link', { name: 'View this day on Home' }).getAttribute('href')).toBe('/?from=2024-05-01&to=2024-05-01');
    expect(screen.getByRole('link', { name: /Before Song/ }).getAttribute('href')).toBe('/music/plays/p0');
    expect(screen.getByRole('link', { name: /After Song/ }).getAttribute('href')).toBe('/music/plays/p2');
    expect(screen.getByRole('link', { name: 'Show in library' }).getAttribute('href')).toContain('q=Sun+%26+Moon');
    await user.click(screen.getByRole('link', { name: 'View this session on Home' }));
    expect(screen.getByTestId('probe').textContent).toBe('/?from=2024-05-01&to=2024-05-01|{"focusSession":"sess1"}');
  });

  it('keeps it simple for a scrobbled play: where it came from, no note, companions or map', async () => {
    scrobbleMock.mockResolvedValue({
      ...PLAY, source: 'multi-scrobbler', note: null, companions: [], latitude: null, longitude: null, location_accuracy: null,
      listened_for: null, art_id: null, history: { ...PLAY.history, plays: 1 }, session: { ...PLAY.session, position: 1, count: 1, previous: null, next: null },
    });
    renderPage();
    await screen.findByRole('heading', { name: /Sun & Moon/ });
    expect(screen.getByText('Scrobbled by multi-scrobbler')).toBeTruthy();
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.queryByText(/With /)).toBeNull();
    expect(document.querySelector('img[alt$="cover"]')).toBeNull();
    expect(screen.getByText(/played this 1 time\b/)).toBeTruthy();
    expect(screen.getByText(/1st of 1/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Before|After/ })).toBeNull();
  });

  it('edits through the check-in form and deletes after a confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /Sun & Moon/ });
    expect(screen.getByRole('link', { name: /Edit/ }).getAttribute('href')).toBe('/music-check-in?edit=p1');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    deleteMock.mockResolvedValue({ id: 'p1' });
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('p1'));
    // Back to where it was opened from.
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('/earlier'));
    confirm.mockRestore();
  });

  it('says why a delete failed and stays', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteMock.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByRole('heading', { name: /Sun & Moon/ });
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Sun & Moon/ })).toBeTruthy();
  });

  it('shows photos from that time when Immich is connected', async () => {
    settingsGet.mockResolvedValue({ immich_url: 'https://immich.example/' });
    photosMock.mockResolvedValue({ p1: [{ id: 'ph1', originalFileName: 'IMG_1.jpg' }] });
    renderPage();
    const photo = await screen.findByAltText('IMG_1.jpg');
    expect(photo.getAttribute('src')).toBe('/thumb/ph1');
    expect(photo.closest('a')?.getAttribute('href')).toBe('https://immich.example/photos/ph1');
    expect(photosMock).toHaveBeenCalledWith(['p1']);
  });

  it('shows no photo section without Immich or photos', async () => {
    renderPage();
    await screen.findByRole('heading', { name: /Sun & Moon/ });
    expect(screen.queryByText('Photos')).toBeNull();
    expect(photosMock).not.toHaveBeenCalled();
  });

  it('says so when the play can\'t be loaded', async () => {
    scrobbleMock.mockRejectedValue(new Error('No such play'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('No such play');
  });

  it('labels where a play came from', () => {
    expect([null, 'manual', 'multi-scrobbler', 'lastfm', 'import'].map(sourceLabel)).toEqual([
      'Scrobbled', 'Written down by hand', 'Scrobbled by multi-scrobbler', 'Imported from Last.fm', 'Imported',
    ]);
  });
});
