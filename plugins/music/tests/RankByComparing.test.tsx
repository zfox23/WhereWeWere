import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RankByComparing } from '../ui/RankByComparing';
import { orderOf, type RankSessionState } from '../../../client/src/components/lists/ranking/engine';

const api = {
  rankSession: vi.fn(),
  saveRankSession: vi.fn(async () => ({ saved: true })),
  discardRankSession: vi.fn(async () => ({ deleted: true })),
  rankList: vi.fn(async (_id: string, ids: string[]) => ({ ranked_ids: ids })),
};
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
  music: new Proxy({}, { get: (_t, k: string) => (...args: unknown[]) => (api as any)[k](...args) }),
}));

const item = (id: string, title: string, rank: number | null, extra: object = {}) => ({
  id, title, rank, kind: 'album' as const, artists: ['Artist'], album: title, album_ref: `${title}|artist`,
  art_id: null, item_key: `album:${title}`, added_at: '2024-01-01T00:00:00Z',
  plays: 5, listened_seconds: 0, last_played_at: null, ...extra,
});
const ITEMS = [item('a', 'Alpha', null), item('b', 'Bravo', null), item('c', 'Charlie', null)];
const LIST = { id: 'l1', name: 'Favorites', updated_at: '', item_count: 3, covers: [], items: [] };

const renderTool = (items = ITEMS) => {
  const onDone = vi.fn();
  render(<RankByComparing list={LIST} items={items} onDone={onDone} />);
  return onDone;
};
const savedState = (over: Partial<RankSessionState> = {}): RankSessionState => ({
  mode: 'scratch', itemIds: ['a', 'b', 'c'], initialRanks: { a: null, b: null, c: null }, answers: [], ...over,
});
const lastSaved = () => (api.saveRankSession.mock.calls.at(-1) as any)[1] as RankSessionState;

/** Always prefer the first-listed contender until the result is shown. */
async function answerUntilPreview(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 40; i++) {
    if (screen.queryByRole('button', { name: /Apply this ranking/ })) return;
    const prefer = screen.queryAllByRole('button', { name: /^Prefer / })[0];
    if (!prefer) break;
    await user.click(prefer);
  }
}

describe('RankByComparing', () => {
  beforeEach(() => {
    api.rankSession.mockRejectedValue(new Error('none')); // no paused session
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('goes straight to the questions when nothing is ranked yet', async () => {
    renderTool();
    expect(await screen.findAllByRole('button', { name: /^Prefer / })).toHaveLength(2);
    expect(screen.queryByText(/Continue from my ranking/)).toBeNull();
    expect(screen.getByText(/0 answered/)).toBeTruthy();
    // The new session is saved at once.
    await waitFor(() => expect(api.saveRankSession).toHaveBeenCalledWith('l1', expect.objectContaining({ mode: 'scratch', answers: [] })));
  });

  it('asks how to start when some items are ranked', async () => {
    const user = userEvent.setup();
    renderTool([item('a', 'Alpha', 1), item('b', 'Bravo', null), item('c', 'Charlie', 2)]);
    await user.click(await screen.findByRole('button', { name: 'Continue from my ranking' }));
    expect(lastSaved().mode).toBe('continue');
    expect(lastSaved().initialRanks).toEqual({ a: 1, b: null, c: 2 });
    expect(await screen.findAllByRole('button', { name: /^Prefer / })).toHaveLength(2);
  });

  it('shows each contender with its kind, artist and plays, and answers by click, saving every time', async () => {
    const user = userEvent.setup();
    renderTool([item('a', 'Alpha', null, { art_id: 'art1' }), item('b', 'Bravo', null, { kind: 'song', album: 'Some Album' }), item('c', 'Charlie', null)]);
    const [first] = await screen.findAllByRole('button', { name: /^Prefer / });
    expect(first.textContent).toMatch(/Artist/);
    expect(first.textContent).toMatch(/5 plays/);
    await user.click(first);
    await waitFor(() => expect(lastSaved().answers).toHaveLength(1));
    expect(lastSaved().answers[0].r).toBe('a');
    expect(screen.getByText(/1 answered/)).toBeTruthy();
  });

  it('answers from the keyboard: left, right, down for a tie, backspace to undo', async () => {
    const user = userEvent.setup();
    renderTool([item('a', 'Alpha', null), item('b', 'Bravo', null), item('c', 'Charlie', null), item('d', 'Delta', null)]);
    await screen.findAllByRole('button', { name: /^Prefer / });
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(lastSaved().answers.map((x) => x.r)).toEqual(['a', 'b', 'tie']));
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(lastSaved().answers.map((x) => x.r)).toEqual(['a', 'b']));
    await user.keyboard('z');
    await waitFor(() => expect(lastSaved().answers).toHaveLength(1));
  });

  it('has a "Can\'t decide" button and an Undo button', async () => {
    const user = userEvent.setup();
    renderTool([item('a', 'Alpha', null), item('b', 'Bravo', null), item('c', 'Charlie', null), item('d', 'Delta', null)]);
    expect((await screen.findByRole('button', { name: 'Undo' })).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: /Can't decide/ }));
    await waitFor(() => expect(lastSaved().answers[0].r).toBe('tie'));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(lastSaved().answers).toEqual([]));
  });

  it('ends by itself with a preview of old and new ranks, and applies only on confirmation', async () => {
    const user = userEvent.setup();
    const onDone = renderTool([item('a', 'Alpha', 3), item('b', 'Bravo', 1), item('c', 'Charlie', 2)]);
    await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
    await answerUntilPreview(user);
    await screen.findByRole('button', { name: /Apply this ranking/ });
    expect(screen.getByText(/Every neighbouring pair is settled/)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(api.rankList).not.toHaveBeenCalled(); // nothing changed yet

    await user.click(screen.getByRole('button', { name: /Apply this ranking/ }));
    await waitFor(() => expect(api.rankList).toHaveBeenCalledTimes(1));
    const ids = api.rankList.mock.calls[0][1];
    expect([...ids].sort()).toEqual(['a', 'b', 'c']); // every item gets a rank
    expect(api.discardRankSession).toHaveBeenCalledWith('l1');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
  });

  it('shows what would move in the preview', async () => {
    const user = userEvent.setup();
    renderTool([item('a', 'Alpha', 1), item('b', 'Bravo', 2), item('c', 'Charlie', 3)]);
    await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
    await answerUntilPreview(user);
    await screen.findByRole('button', { name: /Apply this ranking/ });
    expect(screen.getByText(/would change rank|Nothing would move/)).toBeTruthy();
    expect(screen.getAllByLabelText(/^Was |Unchanged/).length).toBeGreaterThan(0);
  });

  it('"Finish now" shows the result so far, with unsettled pairs keeping their order, and can go back', async () => {
    const user = userEvent.setup();
    renderTool([item('a', 'Alpha', null), item('b', 'Bravo', null), item('c', 'Charlie', null), item('d', 'Delta', null)]);
    expect((await screen.findByRole('button', { name: 'Finish now' })).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: /^Prefer / })[0]);
    await user.click(screen.getByRole('button', { name: 'Finish now' }));
    expect(await screen.findByText(/still unsettled/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep answering' }));
    expect(await screen.findAllByRole('button', { name: /^Prefer / })).toHaveLength(2);
  });

  it('discarding drops the saved session without touching ranks', async () => {
    const user = userEvent.setup();
    const onDone = renderTool();
    await screen.findAllByRole('button', { name: /^Prefer / });
    await user.click(screen.getAllByRole('button', { name: /^Prefer / })[0]);
    await user.click(screen.getByRole('button', { name: 'Finish now' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(api.discardRankSession).toHaveBeenCalledWith('l1');
    expect(api.rankList).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
  });

  it('pausing leaves the saved session in place', async () => {
    const user = userEvent.setup();
    const onDone = renderTool();
    await screen.findAllByRole('button', { name: /^Prefer / });
    await user.click(screen.getByRole('button', { name: /Pause and go back/ }));
    expect(onDone).toHaveBeenCalledWith(false);
    expect(api.discardRankSession).not.toHaveBeenCalled();
  });

  it('offers to resume a paused session, and carries on where it left off', async () => {
    const user = userEvent.setup();
    api.rankSession.mockResolvedValue({ state: savedState({ answers: [{ a: 'a', b: 'b', r: 'a' }] }), updated_at: '' });
    renderTool();
    await user.click(await screen.findByRole('button', { name: 'Resume (1 answered)' }));
    expect(await screen.findByText(/1 answered/)).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /^Prefer / })[0]);
    await waitFor(() => expect(lastSaved().answers).toHaveLength(2));
    expect(lastSaved().answers[0]).toEqual({ a: 'a', b: 'b', r: 'a' }); // the earlier answer is kept
  });

  it('starting over replaces a paused session', async () => {
    const user = userEvent.setup();
    api.rankSession.mockResolvedValue({ state: savedState({ answers: [{ a: 'a', b: 'b', r: 'a' }] }), updated_at: '' });
    renderTool();
    await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
    await waitFor(() => expect(lastSaved().answers).toEqual([]));
  });

  it('drops answers about items that have left the list since it was paused', async () => {
    const user = userEvent.setup();
    api.rankSession.mockResolvedValue({
      state: savedState({ itemIds: ['a', 'b', 'gone'], answers: [{ a: 'a', b: 'gone', r: 'a' }, { a: 'a', b: 'b', r: 'a' }] }),
      updated_at: '',
    });
    renderTool([item('a', 'Alpha', null), item('b', 'Bravo', null), item('c', 'Charlie', null)]);
    await user.click(await screen.findByRole('button', { name: 'Resume (1 answered)' }));
    await waitFor(() => expect(lastSaved().itemIds.sort()).toEqual(['a', 'b', 'c']));
    expect(lastSaved().answers).toEqual([{ a: 'a', b: 'b', r: 'a' }]);
  });

  it('warns, but keeps going, when progress cannot be saved', async () => {
    api.saveRankSession.mockRejectedValue(new Error('offline'));
    renderTool();
    expect(await screen.findByText("Couldn't save progress")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Prefer / })).toHaveLength(2);
    api.saveRankSession.mockResolvedValue({ saved: true } as any);
  });

  it('shows an error and stays on the result when applying fails', async () => {
    const user = userEvent.setup();
    api.rankList.mockRejectedValueOnce(new Error('Failed to rank'));
    const onDone = renderTool();
    await screen.findAllByRole('button', { name: /^Prefer / });
    await user.click(screen.getAllByRole('button', { name: /^Prefer / })[0]);
    await user.click(screen.getByRole('button', { name: 'Finish now' }));
    await user.click(await screen.findByRole('button', { name: /Apply this ranking/ }));
    expect(await screen.findByText('Failed to rank')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(orderOf).toBeTruthy();
  });
});
