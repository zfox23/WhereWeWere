/// <reference types="@testing-library/jest-dom" />
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TrackFilter } from '../ui/TrackFilter';
import { NO_ACTIVITY_TYPE, NO_ACTIVITY_TYPE_LABEL } from '../constants';

const apiMocks = vi.hoisted(() => ({
  activityTypes: vi.fn(),
}));

vi.mock('../ui/api', () => ({
  tracks: {
    activityTypes: apiMocks.activityTypes,
  },
}));

const OPTIONS = ['Cycling', 'Hiking'];

function renderFilter(
  params: Record<string, string>,
  onSetParam = vi.fn()
) {
  const utils = render(
    <TrackFilter
      included
      filtersDisabled={false}
      sectionDisabled={false}
      typeToggleDisabled={false}
      params={params}
      onToggleIncluded={vi.fn()}
      onSetParam={onSetParam}
    />
  );
  return { onSetParam, input: screen.getByRole('combobox'), ...utils };
}

function datalistOptionValues(container: HTMLElement): string[] {
  return [...container.querySelectorAll('datalist option')].map((o) => o.value);
}

describe('TrackFilter (activity type)', () => {
  beforeEach(() => {
    apiMocks.activityTypes.mockReset().mockResolvedValue(OPTIONS);
  });

  afterEach(() => {
    cleanup();
  });

  it('offers the "(No type)" option alongside real activity types', async () => {
    const { container } = renderFilter({});
    await screen.findByRole('combobox');
    // Wait for the async activity-types fetch to populate the datalist.
    await vi.waitFor(() => {
      expect(datalistOptionValues(container)).toContain('Cycling');
    });
    expect(datalistOptionValues(container)).toContain(NO_ACTIVITY_TYPE_LABEL);
  });

  it('sets the no-type sentinel when the user picks "(No type)"', async () => {
    const { onSetParam, input } = renderFilter({});
    await userEvent.type(input, NO_ACTIVITY_TYPE_LABEL);
    expect(onSetParam).toHaveBeenCalledWith('track_activity', NO_ACTIVITY_TYPE);
  });

  it('displays the no-type sentinel as its label in the input', async () => {
    const { input } = renderFilter({ track_activity: NO_ACTIVITY_TYPE });
    expect(input).toHaveValue(NO_ACTIVITY_TYPE_LABEL);
  });

  it('sets a real type on exact match', async () => {
    const { onSetParam, input } = renderFilter({});
    await userEvent.type(input, 'Cycling');
    expect(onSetParam).toHaveBeenLastCalledWith('track_activity', 'Cycling');
  });

  it('clears the filter when the input no longer matches an option', async () => {
    const { onSetParam, input } = renderFilter({ track_activity: 'Cycling' });
    await userEvent.type(input, '!');
    expect(onSetParam).toHaveBeenLastCalledWith('track_activity', '');
  });

  it('clears the no-type filter when the label is edited away', async () => {
    const { onSetParam, input } = renderFilter({ track_activity: NO_ACTIVITY_TYPE });
    await userEvent.type(input, 'X');
    expect(onSetParam).toHaveBeenLastCalledWith('track_activity', '');
  });
});
