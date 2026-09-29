import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScubaSettings } from '../ui/ScubaSettings';

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  importFile: vi.fn(),
}));

vi.mock('../ui/api', () => ({
  scubaLogbookImport: {
    preview: apiMocks.preview,
    importFile: apiMocks.importFile,
  },
}));

const sqlFile = new File(['CREATE TABLE Logbook...'], 'logbook.sql', { type: 'application/sqlite' });

const previewFixture = {
  total: 2,
  rows: [
    {
      source_uuid: 'UUID-A',
      source_number: 1,
      place: 'Shore Break',
      city: 'Monterey',
      local_date: '2020-06-19',
      entry_time: '09:23',
      depth: 10,
      bottom_time: 30.5,
      checkin_timezone: 'Etc/GMT+8',
      timezone_source: 'utc_offset',
      checked_in_at: '2020-06-19T17:23:00.000Z',
    },
    {
      source_uuid: 'UUID-B',
      source_number: 2,
      place: 'Mystery Wreck',
      city: null,
      local_date: '2019-09-26',
      entry_time: '18:23',
      depth: 15,
      bottom_time: 40,
      checkin_timezone: 'UTC',
      timezone_source: 'fallback',
      checked_in_at: '2019-09-26T18:23:00.000Z',
    },
  ],
  errors: [],
} as any;

const importFixture = {
  imported: 2,
  skipped: 0,
  imported_ids: ['checkin-a', 'checkin-b'],
  errors: [],
  total_errors: 0,
} as any;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiMocks.preview.mockReset();
  apiMocks.importFile.mockReset();
});

async function selectFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
}

describe('ScubaSettings — Diving Log import', () => {
  it('requires a file before previewing', () => {
    render(<ScubaSettings />);
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull();
  });

  it('previews dives, adjusts a timezone, and passes the override to the import', async () => {
    apiMocks.preview.mockResolvedValue(previewFixture);
    apiMocks.importFile.mockResolvedValue(importFixture);

    render(<ScubaSettings />);
    const user = userEvent.setup();
    await selectFile(user, sqlFile);

    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => {
      expect(apiMocks.preview).toHaveBeenCalledWith(sqlFile);
    });

    // Preview table shows both dives and their resolved timezones.
    await screen.findByText('Shore Break, Monterey');
    expect(screen.getByText('Mystery Wreck')).toBeTruthy();
    // "Assumed UTC" appears in the summary stat and on the fallback row's badge.
    expect(screen.getAllByText('Assumed UTC').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue('Etc/GMT+8')).toBeTruthy();
    expect(screen.getByDisplayValue('UTC')).toBeTruthy();

    // Adjust the fallback row's timezone.
    const tzInput = screen.getByDisplayValue('UTC');
    fireEvent.change(tzInput, { target: { value: 'America/Los_Angeles' } });

    await user.click(screen.getByRole('button', { name: /import 2 dive/i }));

    await waitFor(() => {
      expect(apiMocks.importFile).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.importFile).toHaveBeenCalledWith(sqlFile, {
      'UUID-B': 'America/Los_Angeles',
    });

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeTruthy();
    });
  });

  it('imports with no overrides when timezones are untouched', async () => {
    apiMocks.preview.mockResolvedValue(previewFixture);
    apiMocks.importFile.mockResolvedValue(importFixture);

    render(<ScubaSettings />);
    const user = userEvent.setup();
    await selectFile(user, sqlFile);
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /import 2 dive/i }));

    await waitFor(() => {
      expect(apiMocks.importFile).toHaveBeenCalledWith(sqlFile, undefined);
    });
  });

  it('surfaces preview errors without crashing', async () => {
    apiMocks.preview.mockRejectedValue(new Error('Not a Diving Log backup'));

    render(<ScubaSettings />);
    const user = userEvent.setup();
    await selectFile(user, sqlFile);
    await user.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(screen.getByText('Not a Diving Log backup')).toBeTruthy();
    });
    expect(apiMocks.importFile).not.toHaveBeenCalled();
  });
});
