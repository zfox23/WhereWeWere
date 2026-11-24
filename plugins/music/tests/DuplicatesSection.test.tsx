import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DuplicatesSection } from '../ui/DuplicatesSection';
import { removedPlaysFile } from '../ui/duplicatesFile';
import { parseScrobbleExport } from '../services/importParser';
import type { DuplicateBurst, DuplicatePlay } from '../ui/types';

const scanMock = vi.fn();
const removeMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    duplicates: () => scanMock(),
    removeDuplicates: (...args: unknown[]) => removeMock(...args),
  },
}));

const p = (id: string, second: number, over: Partial<DuplicatePlay> = {}): DuplicatePlay => ({
  id,
  played_at: new Date(Date.UTC(2018, 10, 27, 20, 0, second)).toISOString(),
  title: 'Rush Over Me',
  artists: ['Said the Sky'],
  album_artists: ['Said the Sky'],
  timezone: 'UTC',
  source: 'lastfm',
  album: 'Healing',
  track_length: null,
  listened_for: null,
  protected: false,
  ...over,
});

const burst = (id: string, title: string, removeCount: number): DuplicateBurst => ({
  id,
  song_key: title.toLowerCase(),
  title,
  artists: ['Said the Sky'],
  length: null,
  threshold: 30,
  keep: [p(id, 0, { title })],
  remove: Array.from({ length: removeCount }, (_, i) => p(`${id}-${i}`, (i + 1) * 2, { title })),
});

describe('DuplicatesSection', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    scanMock.mockReset();
    removeMock.mockReset();
  });

  it('previews the bursts without removing anything, and says when there are none', async () => {
    const user = userEvent.setup();
    scanMock.mockResolvedValueOnce({ bursts: [], removable: 0 });
    render(<DuplicatesSection onRemoved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Scan for duplicates/ }));
    await waitFor(() => expect(screen.getByText('No impossible duplicates found.')).toBeTruthy());

    scanMock.mockResolvedValueOnce({ bursts: [burst('a', 'Rush Over Me', 3), burst('b', 'Treasure', 1)], removable: 4 });
    await user.click(screen.getByRole('button', { name: /Scan again/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Found 4 plays to remove in 2 bursts\. Across 2 songs/));
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toMatch(/Nov 27, 2018: keeps one play, removes 3 \(8:00:02 PM – 8:00:06 PM\)/);
    expect(rows[1].textContent).toMatch(/removes 1 \(8:00:02 PM\)/);
    expect(removeMock).not.toHaveBeenCalled();

    // Expanding a burst lists every play, kept and removed.
    await user.click(screen.getByRole('button', { name: /Rush Over Me/ }));
    expect(screen.getAllByText('removed')).toHaveLength(3);
    expect(screen.getByText('kept')).toBeTruthy();
  });

  it('removes only the selected bursts after confirmation, then offers the removed plays', async () => {
    const user = userEvent.setup();
    const onRemoved = vi.fn();
    const a = burst('a', 'Rush Over Me', 3);
    scanMock.mockResolvedValue({ bursts: [a, burst('b', 'Treasure', 1)], removable: 4 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    removeMock.mockResolvedValue({ removed: 3, plays: a.remove });
    render(<DuplicatesSection onRemoved={onRemoved} />);
    await user.click(screen.getByRole('button', { name: /Scan for duplicates/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Remove 4 plays' }));

    await user.click(screen.getByRole('checkbox', { name: /Treasure/ }));
    await user.click(screen.getByRole('button', { name: 'Remove 3 plays' }));
    expect(removeMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove 3 plays' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText(/Removed 3 plays/)).toBeTruthy());
    expect(removeMock).toHaveBeenCalledWith(['a-0', 'a-1', 'a-2']);
    expect(onRemoved).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Download removed plays/ })).toBeTruthy();
  });

  it('writes a file the Maloja import reads back as the same plays', () => {
    const plays = [p('x', 4, { track_length: 200, listened_for: 150, timezone: 'America/Chicago' }), p('y', 2, { album: null })];
    const { scrobbles, skipped } = parseScrobbleExport(removedPlaysFile(plays));
    expect(skipped).toBe(0);
    expect(scrobbles.map((s) => s.playedAt.toISOString())).toEqual([plays[1].played_at, plays[0].played_at]);
    expect(scrobbles[1]).toMatchObject({
      title: 'Rush Over Me', artists: ['Said the Sky'], album: 'Healing', albumArtists: ['Said the Sky'],
      trackLength: 200, listenedFor: 150, source: 'lastfm', timezone: 'America/Chicago',
    });
    expect(scrobbles[0].album).toBeNull();
  });
});
