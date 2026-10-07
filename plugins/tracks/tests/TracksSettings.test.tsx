/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TracksSettings } from '../ui/TracksSettings';

const apiMocks = vi.hoisted(() => ({
  activityTypeSummary: vi.fn(),
  renameActivityType: vi.fn(),
}));

vi.mock('../ui/api', () => ({
  tracks: {
    activityTypeSummary: apiMocks.activityTypeSummary,
    renameActivityType: apiMocks.renameActivityType,
  },
}));

const SUMMARY = [
  { name: 'Cycling', count: 3 },
  { name: 'Hiking', count: 1 },
];

describe('TracksSettings (activity types pane)', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiMocks.activityTypeSummary.mockReset().mockResolvedValue(SUMMARY);
    apiMocks.renameActivityType.mockReset().mockResolvedValue({ updated: 0, merged: false });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    cleanup();
  });

  it('lists every activity type with a count linking to a filtered Home tab', async () => {
    render(<TracksSettings />);

    expect(await screen.findByText('Cycling')).toBeTruthy();
    expect(screen.getByText('Hiking')).toBeTruthy();

    const cyclingCount = screen.getByRole('link', { name: '3 tracks' });
    expect(cyclingCount).toHaveAttribute('href', '/?track_activity=Cycling');
    expect(cyclingCount).toHaveAttribute('target', '_blank');

    const hikingCount = screen.getByRole('link', { name: '1 track' });
    expect(hikingCount).toHaveAttribute('href', '/?track_activity=Hiking');
  });

  it('renames a type to a fresh name without merging', async () => {
    const user = userEvent.setup();
    render(<TracksSettings />);
    await screen.findByText('Cycling');

    await user.click(screen.getByRole('button', { name: 'Rename Cycling' }));
    const input = screen.getByRole('textbox', { name: 'Rename activity type Cycling' });
    await user.clear(input);
    await user.type(input, 'Bike Riding');
    await user.tab();

    await waitFor(() => {
      expect(apiMocks.renameActivityType).toHaveBeenCalledWith('Cycling', 'Bike Riding', false);
    });
  });

  it('asks to merge when the new name already exists, then merges on confirm', async () => {
    const user = userEvent.setup();
    render(<TracksSettings />);
    await screen.findByText('Hiking');

    await user.click(screen.getByRole('button', { name: 'Rename Hiking' }));
    const input = screen.getByRole('textbox', { name: 'Rename activity type Hiking' });
    await user.clear(input);
    await user.type(input, 'Cycling');
    await user.tab();

    await waitFor(() => {
      expect(apiMocks.renameActivityType).toHaveBeenCalledWith('Hiking', 'Cycling', true);
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Merge "Hiking" into "Cycling"?'),
    );
  });

  it('does not rename when the merge is declined', async () => {
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();
    render(<TracksSettings />);
    await screen.findByText('Hiking');

    await user.click(screen.getByRole('button', { name: 'Rename Hiking' }));
    const input = screen.getByRole('textbox', { name: 'Rename activity type Hiking' });
    await user.clear(input);
    await user.type(input, 'Cycling');
    await user.tab();

    await new Promise((r) => setTimeout(r, 0));
    expect(apiMocks.renameActivityType).not.toHaveBeenCalled();
    // Still in edit mode with the entered name
    expect(screen.getByRole('textbox', { name: 'Rename activity type Hiking' })).toHaveValue(
      'Cycling',
    );
  });

  it('refuses an empty name without calling the API', async () => {
    const user = userEvent.setup();
    render(<TracksSettings />);
    await screen.findByText('Cycling');

    await user.click(screen.getByRole('button', { name: 'Rename Cycling' }));
    const input = screen.getByRole('textbox', { name: 'Rename activity type Cycling' });
    await user.clear(input);
    await user.tab();

    await new Promise((r) => setTimeout(r, 0));
    expect(apiMocks.renameActivityType).not.toHaveBeenCalled();
    expect(screen.getByText('Activity type name cannot be empty.')).toBeTruthy();
  });

  it('shows a server 409 and offers the merge when the clash appeared since load', async () => {
    // First summary fetch: no "Trail" type. After the user types it and
    // commits, the server 409s; the fallback confirm is then accepted.
    apiMocks.activityTypeSummary.mockResolvedValue(SUMMARY);
    apiMocks.renameActivityType
      .mockRejectedValueOnce(
        new Error('An activity type named "Trail" already exists with 2 tracks. Send merge: true to combine them.'),
      )
      .mockResolvedValueOnce({ updated: 1, merged: true });
    const user = userEvent.setup();
    render(<TracksSettings />);
    await screen.findByText('Cycling');

    await user.click(screen.getByRole('button', { name: 'Rename Cycling' }));
    const input = screen.getByRole('textbox', { name: 'Rename activity type Cycling' });
    await user.clear(input);
    await user.type(input, 'Trail');
    await user.tab();

    await waitFor(() => {
      expect(apiMocks.renameActivityType).toHaveBeenLastCalledWith('Cycling', 'Trail', true);
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Merge "Cycling" into "Trail"?'),
    );
  });
});
