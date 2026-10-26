import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlbumLink } from '../ui/AlbumLink';
import { AlbumModal } from '../ui/AlbumModal';
import { resetMusicLists } from '../ui/useMusicLists';

type Item = { id: string; item_key: string; kind: 'song' | 'album'; title: string; artists: string[]; album: string | null; album_ref: string | null; art_id: null };
let lists: { id: string; name: string; items: Item[] }[] = [];
const albumViewMock = vi.fn();
const addMock = vi.fn(async (listId: string, target: any) => {
  const list = lists.find((l) => l.id === listId)!;
  list.items.push({
    id: `i${list.items.length + 1}`, kind: target.kind, item_key: target.kind === 'album' ? `album:${target.album_ref}` : `song:${target.song_key}`,
    title: 'x', artists: [], album: null, album_ref: null, art_id: null,
  });
  return { added: true };
});
const removeMock = vi.fn(async (listId: string, itemId: string) => {
  const list = lists.find((l) => l.id === listId)!;
  list.items = list.items.filter((i) => i.id !== itemId);
  return { id: itemId };
});
const createMock = vi.fn(async (name: string) => {
  const list = { id: `l${lists.length + 1}`, name, items: [] };
  lists.push(list);
  return list;
});
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
  music: {
    albumView: (...a: unknown[]) => albumViewMock(...a),
    lists: async () => JSON.parse(JSON.stringify(lists)),
    addToList: (...a: [string, any]) => addMock(...a),
    removeFromList: (...a: [string, string]) => removeMock(...a),
    createList: (n: string) => createMock(n),
  },
}));

const SONG = 'sun & moon\u001fabove & beyond';
const MATCHED = {
  album_ref: 'group therapy|above & beyond', art_id: 'a1', matched: true, title: 'Group Therapy', artist: 'Above & Beyond',
  release_date: '2011-06-14', label: 'Anjunabeats', plays: 3, listened_seconds: 900,
  tracks: [
    { position: 1, title: 'Filaments', artists: ['Above & Beyond'], length: 300, plays: 0, song_key: null },
    { position: 2, title: 'Sun & Moon', artists: ['Above & Beyond'], length: 321, plays: 3, song_key: SONG },
  ],
};
const UNMATCHED = {
  album_ref: 'obscure lp|someone', art_id: null, matched: false, title: 'Obscure LP', artist: 'Someone',
  release_date: null, label: null, plays: 4, listened_seconds: 0,
  tracks: [{ position: null, title: 'Hit', artists: ['Someone'], length: null, plays: 3, song_key: 'hit\u001fsomeone' }],
};
const UNKNOWN = { ...UNMATCHED, album_ref: '|someone', title: 'Unknown album' };

const open = (view = MATCHED, props: object = {}) => {
  albumViewMock.mockResolvedValue(view);
  const onClose = vi.fn();
  render(<AlbumModal albumRef={view.album_ref} onClose={onClose} {...props} />);
  return onClose;
};

describe('AlbumModal', () => {
  beforeEach(() => {
    lists = [{ id: 'l1', name: 'Favorites', items: [] }];
    resetMusicLists();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows an unmatched album from the user\'s plays alone: no cover, no release rows', async () => {
    open(UNMATCHED);
    const dialog = await screen.findByRole('dialog', { name: 'Obscure LP by Someone' });
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.textContent).toContain('4 scrobbles');
    expect(dialog.textContent).toContain('Hit');
    expect(dialog.textContent).toContain('3x');
    expect(dialog.textContent).not.toMatch(/Anjunabeats|No metadata/);
  });

  it('titles plays without an album "Unknown album" and offers no album-level add', async () => {
    open(UNKNOWN);
    await screen.findByRole('dialog', { name: 'Unknown album by Someone' });
    expect(screen.queryByRole('button', { name: 'Add album to list' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Hit to a list' })).toBeTruthy(); // songs still can be
  });

  it('adds the album to a list and shows it as on a list', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Add album to list' }));
    await user.click(await screen.findByRole('checkbox', { name: /Favorites/ }));
    expect(addMock).toHaveBeenCalledWith('l1', { kind: 'album', album_ref: MATCHED.album_ref });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Favorites/ }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getAllByLabelText('On 1 list').length).toBeGreaterThan(0);
    // Toggling again removes it.
    await user.click(screen.getByRole('checkbox', { name: /Favorites/ }));
    expect(removeMock).toHaveBeenCalledWith('l1', 'i1');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Favorites/ }).getAttribute('aria-checked')).toBe('false'));
  });

  it('adds a played song with its album context; tracks never played have no button', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Add Filaments to a list' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Sun & Moon to a list' }));
    await user.click(await screen.findByRole('checkbox', { name: /Favorites/ }));
    expect(addMock).toHaveBeenCalledWith('l1', { kind: 'song', song_key: SONG, album_ref: MATCHED.album_ref });
  });

  it('creates a list from the picker and puts the item on it', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Add Sun & Moon to a list' }));
    await user.type(await screen.findByLabelText('New list name'), 'Road trip');
    await user.click(screen.getByRole('button', { name: 'Create list' }));
    expect(createMock).toHaveBeenCalledWith('Road trip');
    await waitFor(() => expect(addMock).toHaveBeenCalledWith('l2', { kind: 'song', song_key: SONG, album_ref: MATCHED.album_ref }));
  });

  it('Escape closes the picker first, then the modal', async () => {
    const user = userEvent.setup();
    const onClose = open();
    await user.click(await screen.findByRole('button', { name: 'Add album to list' }));
    const picker = await screen.findByRole('dialog', { name: /Add .* to a list/ });
    await user.type(within(picker).getByLabelText('New list name'), '{Escape}');
    expect(screen.queryByRole('dialog', { name: /Add .* to a list/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the library for this album: on the profile in place, elsewhere in a new tab', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    window.history.replaceState(null, '', '/');
    open();
    await user.click(await screen.findByRole('button', { name: 'Show in library' }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('musicView=albums&q=Group+Therapy'), '_blank', 'noopener,noreferrer');
    cleanup();

    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, '', '/profile?tab=plugin:music');
    const onClose = open();
    await user.click(await screen.findByRole('button', { name: 'Show in library' }));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Group Therapy');
    expect(onClose).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe('AlbumLink', () => {
  beforeEach(() => {
    lists = [];
    resetMusicLists();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the album by identity, for albums without a catalog match too', async () => {
    const user = userEvent.setup();
    albumViewMock.mockResolvedValue(UNMATCHED);
    render(<AlbumLink albumRef="obscure lp|someone">Obscure LP</AlbumLink>);
    await user.click(screen.getByRole('link', { name: 'Obscure LP' }));
    expect(await screen.findByRole('dialog', { name: 'Obscure LP by Someone' })).toBeTruthy();
    expect(albumViewMock).toHaveBeenCalledWith({ ref: 'obscure lp|someone', artId: undefined });
  });

  it('is a real link to the album page: modified clicks follow it instead of opening the modal', async () => {
    const user = userEvent.setup();
    render(<AlbumLink albumRef="obscure lp|someone">Obscure LP</AlbumLink>);
    const link = screen.getByRole('link', { name: 'Obscure LP' });
    expect(link.getAttribute('href')).toBe('/music/album?ref=obscure+lp%7Csomeone');
    await user.keyboard('{Control>}');
    await user.click(link);
    await user.keyboard('{/Control}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(albumViewMock).not.toHaveBeenCalled();
  });

  it('defaults the name to "Unknown album" and stays plain text without an identity', () => {
    render(<AlbumLink albumRef="|someone" />);
    expect(screen.getByRole('link', { name: 'Unknown album' })).toBeTruthy();
    cleanup();
    render(<AlbumLink albumRef={null}>Plain</AlbumLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Plain')).toBeTruthy();
  });
});
