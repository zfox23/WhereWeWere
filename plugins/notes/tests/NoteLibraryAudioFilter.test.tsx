import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteLibrary } from '../ui/library/NoteLibrary';
import { notes, type LibraryNote } from '../ui/api';

vi.mock('../ui/api', async (orig) => {
  const actual = await orig<typeof import('../ui/api')>();
  return { ...actual, notes: { ...actual.notes, library: vi.fn(), graph: vi.fn(), get: vi.fn() } };
});
// Not under test: the reading pane loads a note, the web is a lazy chunk.
vi.mock('../ui/library/ReadingPane', () => ({ ReadingPane: () => null }));
vi.mock('../ui/library/SimilarityWeb', () => ({ default: () => null }));

const note = (id: string, title: string, audio_count: number, date = '2024-03-10'): LibraryNote => ({
  id, title, excerpt: `${title} body`, checked_in_at: `${date}T20:00:00Z`, checkin_timezone: 'UTC',
  local_date: date, word_count: 5, tag_ids: [], theme_id: null, audio_count,
});

const NOTES = [
  note('a', 'Walk (audio)', 1, '2024-03-12'),
  note('b', 'Typed only', 0, '2024-03-11'),
  note('c', 'Two memos', 2, '2024-03-10'),
  note('d', 'Old typed', 0, '2019-05-01'), // a different year: collapsed unless filtering
];

const titles = () => screen.queryAllByRole('treeitem', { selected: false }).flatMap((el) => {
  const t = el.textContent ?? '';
  return NOTES.filter((n) => t.includes(n.title!) && !el.getAttribute('aria-expanded')).map((n) => n.title);
});
const icon = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  vi.mocked(notes.library).mockResolvedValue({ notes: NOTES, tags: [], themes: [] });
});
afterEach(cleanup);

describe('Note Library audio filter', () => {
  it('offers three icon-only choices, defaulting to all notes', async () => {
    render(<NoteLibrary />);
    await screen.findByText('Walk (audio)');
    for (const name of ['All notes', 'Notes with audio', 'Notes without audio']) {
      const button = icon(name);
      expect(button).toHaveAttribute('title', name);
      expect(button.textContent).toBe(''); // no visible text, just an icon
    }
    expect(icon('All notes')).toHaveAttribute('aria-checked', 'true');
    expect(icon('Notes with audio')).toHaveAttribute('aria-checked', 'false');
  });

  it('shows only notes with at least one audio file', async () => {
    render(<NoteLibrary />);
    await screen.findByText('Walk (audio)');
    await userEvent.click(icon('Notes with audio'));
    expect(icon('Notes with audio')).toHaveAttribute('aria-checked', 'true');
    expect(titles().sort()).toEqual(['Two memos', 'Walk (audio)']);
  });

  it('shows only notes with no audio, opening every year so older matches are visible', async () => {
    render(<NoteLibrary />);
    await screen.findByText('Walk (audio)');
    await userEvent.click(icon('Notes without audio'));
    expect(titles().sort()).toEqual(['Old typed', 'Typed only']);
  });

  it('goes back to every note with the first icon', async () => {
    render(<NoteLibrary />);
    await screen.findByText('Walk (audio)');
    await userEvent.click(icon('Notes without audio'));
    await userEvent.click(icon('All notes'));
    expect(screen.getByText('Walk (audio)')).toBeInTheDocument();
    expect(screen.getByText('Typed only')).toBeInTheDocument();
  });

  it('combines with the text filter', async () => {
    render(<NoteLibrary />);
    await screen.findByText('Walk (audio)');
    await userEvent.click(icon('Notes with audio'));
    await userEvent.type(screen.getByLabelText('Filter notes'), 'memos');
    await waitFor(() => expect(titles()).toEqual(['Two memos']));
  });

  it('says so when nothing matches', async () => {
    vi.mocked(notes.library).mockResolvedValue({ notes: [note('b', 'Typed only', 0)], tags: [], themes: [] });
    render(<NoteLibrary />);
    await screen.findByText('Typed only');
    await userEvent.click(icon('Notes with audio'));
    expect(screen.getByText('No notes match.')).toBeInTheDocument();
  });
});
