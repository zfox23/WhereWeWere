import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import TrackCheckIn from '../../src/pages/TrackCheckIn';

const apiMocks = vi.hoisted(() => ({
  tracksUpload: vi.fn(),
}));

vi.mock('../../src/api/client', () => ({
  tracks: {
    upload: apiMocks.tracksUpload,
  },
}));

const makeFile = (name: string, type = 'application/gpx+xml') =>
  new File([`<gpx>${name}</gpx>`], name, { type });

const renderPage = () =>
  render(
    <MemoryRouter>
      <TrackCheckIn />
    </MemoryRouter>,
  );

describe('TrackCheckIn multi-upload', () => {
  beforeEach(() => {
    apiMocks.tracksUpload.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('accepts multiple files and shows a per-file link after upload', async () => {
    apiMocks.tracksUpload.mockImplementation((file: File) =>
      Promise.resolve({
        id: `track-${file.name.replace(/\.(gpx|tcx)$/i, '')}`,
        name: `Parsed ${file.name}`,
      })
    );
    const user = userEvent.setup();
    renderPage();

    const input = document.querySelector('input[type="file"]')!;
    await user.upload(input, [makeFile('ride-a.gpx'), makeFile('ride-b.tcx')]);

    expect(screen.getByText('ride-a.gpx')).toBeTruthy();
    expect(screen.getByText('ride-b.tcx')).toBeTruthy();
    expect(input).toHaveAttribute('multiple');

    const save = screen.getByRole('button', { name: /save 2 tracks/i });
    await user.click(save);

    // Both files reach the upload endpoint
    await waitFor(() => {
      expect(apiMocks.tracksUpload).toHaveBeenCalledTimes(2);
    });

    // Successful uploads are replaced with links to the track detail pages
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /view parsed ride-a\.gpx/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /view parsed ride-b\.tcx/i })).toBeTruthy();
    });
    expect(
      screen.getByRole('link', { name: /view parsed ride-a\.gpx/i }),
    ).toHaveAttribute('href', '/tracks/track-ride-a');
    expect(save).toBeDisabled();
  });

  it('skips non-track files with an explanatory message', async () => {
    renderPage();

    const input = document.querySelector('input[type="file"]')!;
    // userEvent.upload filters by the accept attribute, so set the files directly
    fireEvent.change(input, {
      target: { files: [makeFile('ride.gpx'), new File(['nope'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(screen.getByText('ride.gpx')).toBeTruthy();
    expect(screen.queryByText('notes.txt')).not.toBeTruthy();
    expect(
      screen.getByText(/1 file skipped — only .gpx and .tcx track files are supported./i),
    ).toBeTruthy();
  });

  it('shows a link to the existing track when a duplicate is rejected', async () => {
    const dupError = new Error('This track is a duplicate') as Error & {
      duplicate: { id: string; name: string };
    };
    dupError.duplicate = { id: 'existing-1', name: 'Old Ride' };
    apiMocks.tracksUpload.mockRejectedValue(dupError);
    const user = userEvent.setup();
    renderPage();

    const input = document.querySelector('input[type="file"]')!;
    await user.upload(input, [makeFile('dup.gpx')]);
    await user.click(screen.getByRole('button', { name: /save track/i }));

    const link = await screen.findByRole('link', { name: /old ride/i });
    expect(link).toHaveAttribute('href', '/tracks/existing-1');
  });

  it('shows the error message next to a failed file while others succeed', async () => {
    apiMocks.tracksUpload.mockImplementation((file: File) =>
      file.name === 'bad.gpx'
        ? Promise.reject(new Error('Invalid GPX file: no <trk> element found'))
        : Promise.resolve({ id: 'track-good', name: 'Good Ride' })
    );
    const user = userEvent.setup();
    renderPage();

    const input = document.querySelector('input[type="file"]')!;
    await user.upload(input, [makeFile('bad.gpx'), makeFile('good.gpx')]);
    await user.click(screen.getByRole('button', { name: /save 2 tracks/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid gpx file: no <trk> element found/i)).toBeTruthy();
    });
    expect(await screen.findByRole('link', { name: /view good ride/i })).toBeTruthy();
    // The failed file can be removed and re-added
    expect(
      screen.getByRole('button', { name: 'Remove bad.gpx' }),
    ).toBeTruthy();
  });
});
