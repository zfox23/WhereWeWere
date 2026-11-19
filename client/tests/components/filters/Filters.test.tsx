import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Smile, Music } from 'lucide-react';
import type { CheckinTypeClient } from 'wwp-shared';
import Filters, { type PluginFilterSpec } from '../../../src/components/filters/Filters';

afterEach(cleanup);

function plugin(id: string, title: string, icon: unknown, filterSection?: unknown): CheckinTypeClient {
  return {
    id,
    strings: { title },
    fields: [],
    filterParams: [],
    client: { icon, iconColor: 'text-green-500', filterSection },
  } as unknown as CheckinTypeClient;
}

const MoodRefine = () => <div>mood refinements</div>;

function specs(included: Record<string, boolean>, onToggle = vi.fn()): PluginFilterSpec[] {
  return [plugin('mood', 'Mood', Smile, MoodRefine), plugin('music', 'Music', Music)].map((p) => ({
    plugin: p,
    included: included[p.id] ?? true,
    filtersDisabled: false,
    sectionDisabled: false,
    typeToggleDisabled: false,
    params: {},
    onToggleIncluded: () => onToggle(p.id),
    onSetParam: vi.fn(),
  }));
}

const base = {
  hasActiveFilters: false,
  fromDate: '',
  toDate: '',
  onSetDateRange: vi.fn(),
  onClearAll: vi.fn(),
};

describe('Filters', () => {
  it('shows one chip per type and no refinements while every type is included', () => {
    render(<Filters {...base} pluginFilterSpecs={specs({})} />);
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mood', pressed: false })).toBeTruthy();
    expect(screen.queryByText('mood refinements')).toBeNull();
    expect(screen.queryByText(/Reset all/)).toBeNull();
  });

  it('shows the refinements of the single selected type', () => {
    render(<Filters {...base} pluginFilterSpecs={specs({ music: false })} />);
    expect(screen.getByRole('button', { name: 'Mood', pressed: true })).toBeTruthy();
    expect(screen.getByText('mood refinements')).toBeTruthy();
  });

  it('routes chip clicks and the All chip to their handlers', async () => {
    const onToggle = vi.fn();
    const onSelectAllTypes = vi.fn();
    render(<Filters {...base} onSelectAllTypes={onSelectAllTypes} pluginFilterSpecs={specs({ music: false }, onToggle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Music' }));
    expect(onToggle).toHaveBeenCalledWith('music');
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onSelectAllTypes).toHaveBeenCalled();
  });

  it('always shows the From/To inputs and sets the range from them', () => {
    const onSetDateRange = vi.fn();
    render(<Filters {...base} onSetDateRange={onSetDateRange} />);
    const from = screen.getByLabelText('From') as HTMLInputElement;
    fireEvent.change(from, { target: { value: '2024-03-02' } });
    fireEvent.blur(from);
    expect(onSetDateRange).toHaveBeenCalledWith('2024-03-02', '');
    expect(screen.getByLabelText('To')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear dates' })).toBeNull();
  });

  it('shows a single day as one input, with Clear dates', async () => {
    const onSetDateRange = vi.fn();
    render(<Filters {...base} hasActiveFilters fromDate="2024-03-02" toDate="2024-03-02" onSetDateRange={onSetDateRange} />);
    expect((screen.getByLabelText('Day') as HTMLInputElement).value).toBe('2024-03-02');
    expect(screen.getByText(/Reset all/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear dates' }));
    expect(onSetDateRange).toHaveBeenCalledWith('', '');
  });
});
