import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionsTab } from '../../src/components/CompanionsTab';
import type { CompanionSummary } from '../../src/types';

const listMock = vi.fn();
const settingsGetMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  companions: {
    list: () => listMock(),
    photoUrl: (name: string) => `/api/v1/immich/person-photo?name=${encodeURIComponent(name)}`,
  },
  // No immich_* keys by default → companion photos stay hidden.
  settings: { get: () => settingsGetMock() },
}));

const rows: CompanionSummary[] = [
  { name: 'Ada', checkin_count: 3, last_checkin_at: '2024-01-02T00:00:00Z' },
  { name: 'Grace', checkin_count: 1, last_checkin_at: null },
  { name: 'Bob', checkin_count: 5, last_checkin_at: '2024-06-01T00:00:00Z' },
];

/** Names in the order they appear in the table body. */
function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr td:first-child')).map(
    (cell) => cell.textContent ?? '',
  );
}

function ariaSortOf(headerLabel: string): string {
  return (
    screen.getByRole('columnheader', { name: headerLabel }).getAttribute('aria-sort') ??
    'none'
  );
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue(rows);
  settingsGetMock.mockReset();
  settingsGetMock.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

describe('CompanionsTab sorting', () => {
  it('defaults to names sorted ascending', async () => {
    render(<CompanionsTab />);
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(rowNames()).toEqual(['Ada', 'Bob', 'Grace']);
    expect(ariaSortOf('Companion')).toBe('ascending');
  });

  it('toggles ascending/descending by check-in count', async () => {
    const user = userEvent.setup();
    render(<CompanionsTab />);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Check-ins' }));
    expect(rowNames()).toEqual(['Grace', 'Ada', 'Bob']);
    expect(ariaSortOf('Check-ins')).toBe('ascending');

    await user.click(screen.getByRole('button', { name: 'Check-ins' }));
    expect(rowNames()).toEqual(['Bob', 'Ada', 'Grace']);
    expect(ariaSortOf('Check-ins')).toBe('descending');
  });

  it('sorts by last check-in with names without check-ins last in either direction', async () => {
    const user = userEvent.setup();
    render(<CompanionsTab />);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Last check-in' }));
    expect(rowNames()).toEqual(['Ada', 'Bob', 'Grace']);
    expect(ariaSortOf('Last check-in')).toBe('ascending');

    await user.click(screen.getByRole('button', { name: 'Last check-in' }));
    expect(rowNames()).toEqual(['Bob', 'Ada', 'Grace']);
    expect(ariaSortOf('Last check-in')).toBe('descending');
  });

  it('spans the name field across the first three columns while editing', async () => {
    const user = userEvent.setup();
    render(<CompanionsTab />);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Edit Ada' }));
    const input = screen.getByDisplayValue('Ada');
    const row = input.closest('tr');
    // Name cell spans the three data columns; only the actions cell remains separate.
    expect(input.closest('td')?.getAttribute('colSpan')).toBe('3');
    expect(row?.querySelectorAll('td')).toHaveLength(2);
  });

  it('resets to ascending when switching columns', async () => {
    const user = userEvent.setup();
    render(<CompanionsTab />);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Check-ins' }));
    await user.click(screen.getByRole('button', { name: 'Check-ins' }));
    expect(ariaSortOf('Check-ins')).toBe('descending');

    await user.click(screen.getByRole('button', { name: 'Companion' }));
    expect(rowNames()).toEqual(['Ada', 'Bob', 'Grace']);
    expect(ariaSortOf('Companion')).toBe('ascending');
    expect(ariaSortOf('Check-ins')).toBe('none');
  });
});
