import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CoasterpediaCard from '../../ui/CoasterpediaCard';
import type { VenueCoasterpedia } from '../../../../client/src/types';

const refreshMock = vi.fn();
const selectMock = vi.fn();
vi.mock('../../../../client/src/api/client', () => ({
  venues: {
    coasterpediaRefresh: (...args: unknown[]) => refreshMock(...args),
    coasterpediaSelect: (...args: unknown[]) => selectMock(...args),
  },
}));

const DATA = {
  id: 165,
  name: 'Batman The Ride',
  url: 'https://coasterpedia.net/wiki/Batman_The_Ride',
  type: 'coaster',
  status: 'operating',
  dates: { opened: { edtf: '1992-05' } },
  stats: { height: { value: 31.4, unit: 'm', entered: { value: 103, unit: 'ft' } }, speed: { value: 80, unit: 'km/h' } },
  manufacturers: [{ id: 1, name: 'B&M' }],
  restrictions: { min_height: { value: 137, unit: 'cm' } },
  videos: ['dQw4w9WgXcQ'],
};

function renderCard(cp: VenueCoasterpedia, unit: 'metric' | 'imperial' = 'metric', onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <CoasterpediaCard venueId="v1" coasterpedia={cp} distanceUnit={unit} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return onChanged;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CoasterpediaCard', () => {
  it('points to Settings when there is no API key', () => {
    renderCard({ has_key: false, status: null });
    expect(screen.getByText(/Add a Coasterpedia API key/)).toBeTruthy();
    expect(screen.queryByText('Refresh')).toBeNull();
  });

  it('shows matched data in the user\'s units with attribution', () => {
    renderCard({ has_key: true, status: 'matched', data: DATA });
    expect(screen.getByText('31.4 m')).toBeTruthy();
    expect(screen.getByText('B&M')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Coasterpedia' }).getAttribute('href')).toBe('https://coasterpedia.net');
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /View this ride/ }).getAttribute('href')).toBe(DATA.url);
    expect(screen.queryByText(/units converted/)).toBeNull();
  });

  it('converts to imperial and reveals details on expand', async () => {
    renderCard({ has_key: true, status: 'matched', data: DATA }, 'imperial');
    expect(screen.getByText('103 ft')).toBeTruthy();
    expect(screen.getByText(/units converted/)).toBeTruthy();
    expect(screen.queryByText('Rider requirements')).toBeNull();
    await userEvent.click(screen.getByText('More details'));
    expect(screen.getByText('Rider requirements')).toBeTruthy();
    expect(screen.getByText('54 in')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Watch on YouTube/ }).getAttribute('href')).toContain('dQw4w9WgXcQ');
  });

  it('lets the user pick a candidate when several matched', async () => {
    selectMock.mockResolvedValue({ ok: true });
    const onChanged = renderCard({
      has_key: true,
      status: 'ambiguous',
      candidates: [
        { id: 165, name: 'Batman The Ride', park: { name: 'Six Flags Great America' } },
        { id: 169, name: 'Batman The Ride', park: { name: 'Six Flags Magic Mountain' } },
      ],
    });
    await userEvent.click(screen.getByText(/Six Flags Magic Mountain/));
    await waitFor(() => expect(selectMock).toHaveBeenCalledWith('v1', 169));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('accepts a manually entered ID or URL when nothing matched', async () => {
    selectMock.mockResolvedValue({ ok: true });
    renderCard({ has_key: true, status: 'no_match' });
    await userEvent.type(screen.getByLabelText('Coasterpedia attraction ID or URL'), '165');
    await userEvent.click(screen.getByText('Use'));
    await waitFor(() => expect(selectMock).toHaveBeenCalledWith('v1', '165'));
  });

  it('says when the matched record was removed from Coasterpedia', () => {
    renderCard({ has_key: true, status: 'no_match', error: 'This record was removed from Coasterpedia. Enter another ID or URL.' });
    expect(screen.getByText(/was removed from Coasterpedia/)).toBeTruthy();
  });

  it('offers retry on failure and surfaces request errors', async () => {
    refreshMock.mockRejectedValue(new Error('boom'));
    renderCard({ has_key: true, status: 'error', error: 'Coasterpedia returned 500' });
    expect(screen.getByText(/Lookup failed: Coasterpedia returned 500/)).toBeTruthy();
    await userEvent.click(screen.getByText('Refresh'));
    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('keeps showing old data when a refresh failed', () => {
    renderCard({ has_key: true, status: 'error', error: 'Coasterpedia returned 500', data: DATA });
    expect(screen.getByText('31.4 m')).toBeTruthy();
    expect(screen.getByText(/showing the previous data/)).toBeTruthy();
  });
});
