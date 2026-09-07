import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamtrackImportSection } from '../../src/pages/settings/YamtrackImportSection';

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  import: vi.fn(),
}));

vi.mock('../../src/api/client', () => ({
  yamtrackImport: {
    preview: apiMocks.preview,
    import: apiMocks.import,
  },
}));

const csvFile = new File(['header\nrow'], 'export.csv', { type: 'text/csv' });

const previewFixture = {
  counts: {
    total: 4,
    create_tv_show: 1,
    create_episode_checkin: 1,
    create_checkin: 1,
    create_media_item: 1,
    duplicate: 0,
    skipped: 0,
  },
  plans: [
    { line: 2, media_id: '1', source: 'tmdb', media_type: 'tv', title: 'Show', season_number: null, episode_number: null, status: 'Completed', score: null, start_date: '2023-04-04', disposition: 'create_tv_show', reason: '', checkin_type: null, rating: null, raw_score: null, duplicate_of_line: null },
    { line: 3, media_id: '1', source: 'tmdb', media_type: 'episode', title: 'Pilot', season_number: '1', episode_number: '1', status: 'Completed', score: '10', start_date: '2023-04-04', disposition: 'create_episode_checkin', reason: '', checkin_type: 'completed', rating: 4, raw_score: 10, duplicate_of_line: null },
    { line: 4, media_id: '2', source: 'tmdb', media_type: 'movie', title: 'Film', season_number: null, episode_number: null, status: 'Completed', score: null, start_date: '2023-04-05', disposition: 'create_checkin', reason: '', checkin_type: 'completed', rating: null, raw_score: null, duplicate_of_line: null },
    { line: 5, media_id: '3', source: 'hardcover', media_type: 'book', title: 'Book', season_number: null, episode_number: null, status: 'Planning', score: null, start_date: null, disposition: 'create_media_item', reason: '', checkin_type: null, rating: null, raw_score: null, duplicate_of_line: null },
  ],
} as any;

const importFixture = {
  ...previewFixture,
  counts: { ...previewFixture.counts, imported_checkins: 2, duplicates_skipped: 0 },
  plans: previewFixture.plans.map((p: any) => ({
    ...p,
    media_item_id: p.media_type === 'book' ? 'book-id' : 'media-id',
    imported_checkin_id: p.disposition.includes('checkin') ? 'checkin-id' : null,
  })),
} as any;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiMocks.preview.mockReset();
  apiMocks.import.mockReset();
});

async function selectFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
}

describe('YamtrackImportSection', () => {
  it('uploads a file, previews, shows counts and rows, then imports', async () => {
    apiMocks.preview.mockResolvedValue(previewFixture);
    apiMocks.import.mockResolvedValue(importFixture);

    const onImportComplete = vi.fn();
    const { unmount } = render(<YamtrackImportSection onImportComplete={onImportComplete} />);

    const user = userEvent.setup();
    await selectFile(user, csvFile);
    expect(screen.getByText('1 file selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(apiMocks.preview).toHaveBeenCalledTimes(1);
      expect(apiMocks.preview).toHaveBeenCalledWith(csvFile);
    });

    await waitFor(() => {
      expect(screen.getByText('TV shows')).toBeTruthy();
    });
    expect(screen.getByText('Show')).toBeTruthy();
    expect(screen.getByText('Pilot')).toBeTruthy();
    expect(screen.getByText('Film')).toBeTruthy();
    expect(screen.getByText('Book')).toBeTruthy();
    expect(screen.getAllByText('Episode check-in')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(apiMocks.import).toHaveBeenCalledTimes(1);
      expect(apiMocks.import).toHaveBeenCalledWith(csvFile);
    });

    await waitFor(() => {
      expect(screen.getByText(/imported 2 check-in/i)).toBeTruthy();
    });
    expect(onImportComplete).toHaveBeenCalledTimes(1);
    // Result rows link out to the detail page
    expect(screen.getAllByText(/view/i).length).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('surfaces preview errors without crashing', async () => {
    apiMocks.preview.mockRejectedValue(new Error('bad csv'));

    render(<YamtrackImportSection />);
    const user = userEvent.setup();
    await selectFile(user, csvFile);
    await user.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(screen.getByText('bad csv')).toBeTruthy();
    });
    expect(apiMocks.import).not.toHaveBeenCalled();
  });

  it('requires a file before previewing', async () => {
    render(<YamtrackImportSection />);
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull();
  });
});
