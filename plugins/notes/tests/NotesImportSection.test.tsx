import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesImportSection } from '../ui/NotesImportSection';

const api = vi.hoisted(() => ({ preview: vi.fn(), run: vi.fn(), tags: vi.fn() }));

vi.mock('../ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/api')>()),
  notesImport: { preview: api.preview, run: api.run },
  notes: { tags: api.tags },
}));

vi.mock('../../../client/src/utils/slugify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../client/src/utils/slugify')>()),
  deviceTimezone: () => 'America/Chicago',
}));

const row = (index: number, extra: Record<string, unknown> = {}) => ({
  index, filename: `f${index}.md`, title: `Note ${index}`, excerpt: 'First line', checked_in_at: '2017-10-16T01:00:00.000Z',
  timezone: 'America/Chicago', local_date: '2017-10-15', time_source: 'default_evening', tz_source: 'history',
  duplicate: null, selected_default: true, error: null, word_count: 3, ...extra,
});

describe('NotesImportSection', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.tags.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it('previews, lets rows be unticked, and imports with batch tags', async () => {
    api.preview.mockResolvedValue({
      total: 3, selected: 2, fallback_count: 1, duplicate_count: 1,
      rows: [row(0), row(1, { duplicate: 'date_title', selected_default: false }), row(2, { tz_source: 'fallback' })],
    });
    api.run.mockResolvedValue({ imported: 1, skipped: 2, imported_ids: ['x'], errors: [], total_errors: 0 });
    const onImported = vi.fn();
    render(<MemoryRouter><NotesImportSection onImported={onImported} /></MemoryRouter>);

    const files = [0, 1, 2].map((i) => new File(['x'], `f${i}.md`, { type: 'text/markdown', lastModified: 5 }));
    await userEvent.upload(screen.getByLabelText('Files'), files);
    await screen.findByText('Note 0');
    expect(api.preview).toHaveBeenCalledWith(files, 'America/Chicago');
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByText(/Already imported \(same date and title\)/)).toBeTruthy();
    expect(screen.getByText('1 using the fallback zone')).toBeTruthy();

    await userEvent.click(screen.getByLabelText('Import f2.md'));
    await userEvent.type(screen.getByLabelText('Tags'), 'Journal Entries{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /Import 1 note/ }));

    await waitFor(() => expect(api.run).toHaveBeenCalledWith(files, 'America/Chicago', [0], ['Journal Entries']));
    expect(await screen.findByText(/Imported 1 note/)).toBeTruthy();
    expect(onImported).toHaveBeenCalled();
  });

  it('shows a preview error', async () => {
    api.preview.mockRejectedValue(new Error('a.docx is not a .md, .markdown or .txt file'));
    render(<MemoryRouter><NotesImportSection /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText('Files'), [new File(['x'], 'a.md')]);
    expect(await screen.findByText(/not a \.md/)).toBeTruthy();
  });
});
