import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicListsSection } from '../ui/MusicListsSection';
import { MusicLibrarySection } from '../ui/MusicLibrarySection';
import { refreshMusicLists, resetMusicLists } from '../ui/useMusicLists';

const mk = (id: string, kind: 'song' | 'album', title: string, album_ref: string, extra: object = {}) => ({
  id, kind, title, artists: ['Above & Beyond'], album: kind === 'song' ? 'Group Therapy' : title,
  album_ref, art_id: null, rank: null, item_key: kind === 'album' ? `album:${album_ref}` : `song:${id}`, ...extra,
});
const withStats = (item: any, plays: number, seconds: number, last: string | null) => ({ ...item, plays, listened_seconds: seconds, last_played_at: last });
const summary = (l: { id: string; name: string; items: any[]; covers?: string[] }) => ({
  created_at: '2024-04-01T09:30:00Z', updated_at: '2024-05-01T12:00:00Z', item_count: l.items.length, covers: [], ...l,
});
let lists: any[] = [];
const api = {
  lists: vi.fn(async () => JSON.parse(JSON.stringify(lists.map(summary)))),
  listItems: vi.fn(async (id: string) =>
    lists.find((l) => l.id === id).items.map((i: any) => withStats(i, i.kind === 'song' ? 7 : 12, i.kind === 'song' ? 1500 : 4000, '2024-04-01T00:00:00Z'))),
  createList: vi.fn(async (name: string) => {
    const l = { id: 'new', name, items: [] };
    lists.push(l);
    return l;
  }),
  renameList: vi.fn(async (id: string, name: string) => {
    lists.find((l) => l.id === id).name = name;
    return { id, name };
  }),
  deleteList: vi.fn(async (id: string) => {
    lists = lists.filter((l) => l.id !== id);
    return { id };
  }),
  removeFromList: vi.fn(async (listId: string, itemId: string) => {
    const l = lists.find((x) => x.id === listId);
    l.items = l.items.filter((i: any) => i.id !== itemId);
    return { id: itemId };
  }),
  rankList: vi.fn(async (listId: string, ids: string[]) => {
    const l = lists.find((x) => x.id === listId);
    for (const i of l.items) i.rank = ids.includes(i.id) ? ids.indexOf(i.id) + 1 : null;
    return { ranked_ids: ids };
  }),
  rankSession: vi.fn(async () => { throw new Error('none'); }),
  saveRankSession: vi.fn(async () => ({ saved: true })),
  discardRankSession: vi.fn(async () => ({ deleted: true })),
  library: vi.fn(),
  albumView: vi.fn(),
};
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string) => `/art/${id}`,
  music: new Proxy({}, { get: (_t, k: string) => (...args: unknown[]) => (api as any)[k](...args) }),
}));

describe('MusicListsSection', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicSection=lists');
    resetMusicLists();
    lists = [
      { id: 'l1', name: 'Favorites', covers: ['c1', 'c2'], items: [mk('s1', 'song', 'Sun & Moon', 'group therapy|above & beyond'), mk('a1', 'album', 'Group Therapy', 'group therapy|above & beyond', { rank: 1 })] },
      { id: 'l2', name: 'Road trip', items: [] },
    ];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows an index of lists with counts and a cover mosaic', async () => {
    render(<MusicListsSection />);
    await screen.findByText('Favorites');
    expect(screen.getByText(/2 items/)).toBeTruthy();
    expect(screen.getByText(/0 items/)).toBeTruthy();
    expect(document.querySelectorAll('img[src^="/art/"]')).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull(); // nothing open until a list is chosen
  });

  it('shows when each list was created and last changed', async () => {
    render(<MusicListsSection />);
    await screen.findByText('Favorites');
    const card = screen.getByTitle('Open Favorites');
    expect(card.textContent).toMatch(/created .*2024.* · updated .*2024/);
  });

  it('opens the list named in the URL, and keeps the URL in step with the open list', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicSection=lists&musicList=l1');
    render(<MusicListsSection />);
    await screen.findAllByRole('row');
    expect(screen.getByRole('heading', { name: /Favorites/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Back to lists/ }));
    await screen.findByText('Road trip');
    expect(new URLSearchParams(window.location.search).has('musicList')).toBe(false);
    await user.click(screen.getByTitle('Open Road trip'));
    expect(new URLSearchParams(window.location.search).get('musicList')).toBe('l2');
    // Back/forward re-reads it.
    window.history.pushState(null, '', '/profile?tab=plugin:music&musicSection=lists&musicList=l1');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: /Favorites/ })).toBeTruthy();
  });

  it('guides an empty start', async () => {
    lists = [];
    render(<MusicListsSection />);
    expect(await screen.findByText(/No lists yet/)).toBeTruthy();
  });

  it('creates, renames and deletes lists from the index', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MusicListsSection />);
    await screen.findByText('Favorites');

    await user.type(screen.getByLabelText('New list name'), 'Chill');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.createList).toHaveBeenCalledWith('Chill');
    await screen.findByText('Chill');

    await user.click(screen.getByRole('button', { name: 'Rename Chill' }));
    const input = screen.getByLabelText('Rename list Chill');
    await user.clear(input);
    await user.type(input, 'Mellow{Enter}');
    expect(api.renameList).toHaveBeenCalledWith('new', 'Mellow');
    await screen.findByText('Mellow');

    await user.click(screen.getByRole('button', { name: 'Delete Mellow' }));
    expect(api.deleteList).toHaveBeenCalledWith('new');
    await waitFor(() => expect(screen.queryByText('Mellow')).toBeNull());
  });

  it('opens a list as a ranked table: songs and albums with their all-time plays', async () => {
    const user = userEvent.setup();
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Favorites'));
    const rows = await screen.findAllByRole('row');
    const text = rows.map((r) => r.textContent);
    const song = text.find((t) => t?.includes('Sun & Moon'))!;
    const album = text.find((t) => t?.includes('Group Therapy') && !t.includes('Sun & Moon'))!;
    expect(song).toMatch(/song/i);
    expect(song).toContain('Above & Beyond');
    expect(song).toContain('7'); // plays
    expect(song).toContain('25m'); // 1500 s
    expect(album).toMatch(/album/i);
    expect(album).toContain('12');
    expect(api.listItems).toHaveBeenCalledWith('l1');

    await user.click(screen.getByRole('button', { name: /Back to lists/ }));
    expect(await screen.findByText('Road trip')).toBeTruthy();
  });

  it('ranks from the row menu, and removes with a confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Favorites'));
    await screen.findAllByRole('row');

    await user.click(screen.getByRole('button', { name: 'Actions for Sun & Moon' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rank this' })); // joins the end of the ranked block
    await waitFor(() => expect(api.rankList).toHaveBeenCalledWith('l1', ['a1', 's1']));
    await user.click(screen.getByRole('button', { name: 'Actions for Sun & Moon' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to top' }));
    await waitFor(() => expect(api.rankList).toHaveBeenLastCalledWith('l1', ['s1', 'a1']));

    await user.click(screen.getByRole('button', { name: 'Actions for Group Therapy' }));
    await user.click(await screen.findByRole('menuitem', { name: /Remove/ }));
    await waitFor(() => expect(api.removeFromList).toHaveBeenCalledWith('l1', 'a1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Actions for Group Therapy' })).toBeNull());
  });

  it('offers "Rank by comparing" on a list with two or more items, and opens the tool', async () => {
    const user = userEvent.setup();
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Favorites'));
    await user.click(await screen.findByRole('button', { name: 'Rank by comparing' }));
    expect(await screen.findByText(/Rank “Favorites” by comparing/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    // Leaving returns to the list's table.
    await user.click(screen.getByRole('button', { name: /Back to list|Pause and go back/ }));
    expect(await screen.findAllByRole('row')).not.toHaveLength(0);
  });

  it('disables it for a list with fewer than two items', async () => {
    const user = userEvent.setup();
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Road trip'));
    const button = await screen.findByRole('button', { name: 'Rank by comparing' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('says "Resume ranking" when a session was paused', async () => {
    const user = userEvent.setup();
    api.rankSession.mockResolvedValueOnce({
      state: { mode: 'scratch', itemIds: ['s1', 'a1'], initialRanks: { s1: null, a1: 1 }, answers: [{ a: 's1', b: 'a1', r: 'a' }] },
      updated_at: '',
    });
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Favorites'));
    expect(await screen.findByRole('button', { name: 'Resume ranking' })).toBeTruthy();
  });

  it('says what to do with an empty list', async () => {
    const user = userEvent.setup();
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Road trip'));
    expect(await screen.findByText(/Nothing in this list yet/)).toBeTruthy();
  });

  it('closes a list that is deleted elsewhere', async () => {
    const user = userEvent.setup();
    render(<MusicListsSection />);
    await user.click(await screen.findByTitle('Open Favorites'));
    await screen.findAllByRole('row');
    lists = [lists[1]];
    await refreshMusicLists();
    await screen.findByText('Road trip');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('list badges', () => {
  beforeEach(() => {
    resetMusicLists();
    window.history.replaceState(null, '', '/profile?tab=plugin:music');
    lists = [{ id: 'l1', name: 'Favorites', items: [mk('SK', 'song', 'Sun & Moon', 'group therapy|a'), mk('x', 'album', 'Group Therapy', 'group therapy|a')] }];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('hearts songs and albums that are on a list, wherever the library shows them', async () => {
    api.library.mockResolvedValue({ total: 2, rows: [
      { name: 'Sun & Moon', artists: ['A'], album: 'Group Therapy', album_ref: 'group therapy|a', song_key: 'SK', plays: 2, listened_seconds: 1, first_played_at: '2024-01-01T00:00:00Z', last_played_at: '2024-01-02T00:00:00Z' },
      { name: 'Other', artists: ['A'], album: null, album_ref: '|a', song_key: 'OK', plays: 1, listened_seconds: 1, first_played_at: '2024-01-01T00:00:00Z', last_played_at: '2024-01-02T00:00:00Z' },
    ] });
    render(<MusicLibrarySection from="2024-01-01" to="2024-01-31" />);
    await screen.findByText('Sun & Moon');
    // Song heart + album heart on the first row; none on the second.
    const [first, second] = screen.getAllByRole('row').slice(1);
    await waitFor(() => expect(first.querySelectorAll('[aria-label="On 1 list"]')).toHaveLength(2));
    expect(second.querySelectorAll('[aria-label^="On "]')).toHaveLength(0);
    // The album-less song's album reads "Unknown album" and opens details.
    expect(second.textContent).toContain('Unknown album');
    expect(screen.getAllByRole('link', { name: 'Unknown album' })).toHaveLength(1);
  });
});
