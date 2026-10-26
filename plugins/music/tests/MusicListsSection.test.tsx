import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicListsSection } from '../ui/MusicListsSection';
import { MusicLibrarySection } from '../ui/MusicLibrarySection';
import { resetMusicLists } from '../ui/useMusicLists';

const mk = (id: string, kind: 'song' | 'album', title: string, album_ref: string, extra: object = {}) => ({
  id, kind, title, artists: ['Above & Beyond'], album: kind === 'song' ? 'Group Therapy' : title,
  album_ref, art_id: null, item_key: kind === 'album' ? `album:${album_ref}` : `song:${id}`, ...extra,
});
let lists: any[] = [];
const api = {
  lists: vi.fn(async () => JSON.parse(JSON.stringify(lists))),
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
  reorderList: vi.fn(async (listId: string, ids: string[]) => {
    const l = lists.find((x) => x.id === listId);
    l.items = ids.map((id) => l.items.find((i: any) => i.id === id));
    return { item_ids: ids };
  }),
  library: vi.fn(),
  albumView: vi.fn(),
};
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string) => `/art/${id}`,
  music: new Proxy({}, { get: (_t, k: string) => (...args: unknown[]) => (api as any)[k](...args) }),
}));

describe('MusicListsSection', () => {
  beforeEach(() => {
    resetMusicLists();
    lists = [
      { id: 'l1', name: 'Favorites', items: [mk('s1', 'song', 'Sun & Moon', 'group therapy|above & beyond'), mk('a1', 'album', 'Group Therapy', 'group therapy|above & beyond')] },
      { id: 'l2', name: 'Road trip', items: [] },
    ];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the lists, the first one open, with song and album items', async () => {
    render(<MusicListsSection />);
    await screen.findByRole('heading', { name: 'Favorites' });
    expect(screen.getByRole('button', { name: /Road trip/ })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['song', 'album']);
    expect(rows[0].textContent).toContain('Above & Beyond · Group Therapy');
    await userEvent.setup().click(screen.getByRole('button', { name: /Road trip/ }));
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
  });

  it('guides an empty start', async () => {
    lists = [];
    render(<MusicListsSection />);
    expect(await screen.findByText(/Make a list above/)).toBeTruthy();
  });

  it('creates, renames and deletes lists', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MusicListsSection />);
    await screen.findByRole('heading', { name: 'Favorites' });

    await user.type(screen.getByLabelText('New list name'), 'Chill');
    await user.click(screen.getByRole('button', { name: 'Create list' }));
    expect(api.createList).toHaveBeenCalledWith('Chill');
    await screen.findByRole('heading', { name: 'Chill' });

    await user.click(screen.getByRole('button', { name: 'Rename list' }));
    const input = screen.getByLabelText('List name');
    await user.clear(input);
    await user.type(input, 'Mellow{Enter}');
    expect(api.renameList).toHaveBeenCalledWith('new', 'Mellow');
    await screen.findByRole('heading', { name: 'Mellow' });

    await user.click(screen.getByRole('button', { name: 'Delete list' }));
    expect(api.deleteList).toHaveBeenCalledWith('new');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mellow/ })).toBeNull());
  });

  it('removes and reorders items', async () => {
    const user = userEvent.setup();
    render(<MusicListsSection />);
    await screen.findByRole('heading', { name: 'Favorites' });
    expect(screen.getByRole('button', { name: 'Move Sun & Moon up' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Move Sun & Moon down' }));
    expect(api.reorderList).toHaveBeenCalledWith('l1', ['a1', 's1']);
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].getAttribute('data-kind')).toBe('album'));
    await user.click(screen.getByRole('button', { name: 'Remove Group Therapy from the list' }));
    expect(api.removeFromList).toHaveBeenCalledWith('l1', 'a1');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });

  it('surfaces a rename that is refused', async () => {
    const user = userEvent.setup();
    api.renameList.mockRejectedValueOnce(new Error('You already have a list with that name'));
    render(<MusicListsSection />);
    await screen.findByRole('heading', { name: 'Favorites' });
    await user.click(screen.getByRole('button', { name: 'Rename list' }));
    await user.type(screen.getByLabelText('List name'), 'x{Enter}');
    expect(await screen.findByText('You already have a list with that name')).toBeTruthy();
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
    api.library.mockResolvedValue([
      { name: 'Sun & Moon', artists: ['A'], album: 'Group Therapy', album_ref: 'group therapy|a', song_key: 'SK', plays: 2, listened_seconds: 1, first_played_at: '2024-01-01T00:00:00Z', last_played_at: '2024-01-02T00:00:00Z' },
      { name: 'Other', artists: ['A'], album: null, album_ref: '|a', song_key: 'OK', plays: 1, listened_seconds: 1, first_played_at: '2024-01-01T00:00:00Z', last_played_at: '2024-01-02T00:00:00Z' },
    ]);
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
