import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListPicker } from '../../src/components/lists/ListPicker';

const lists = [
  { id: 'a', name: 'Faves', n: 2 },
  { id: 'b', name: 'Later', n: 0 },
];

function setup(over: Partial<Parameters<typeof ListPicker<(typeof lists)[number]>>[0]> = {}) {
  const props = {
    lists,
    isOn: (l: (typeof lists)[number]) => l.id === 'a',
    count: (l: (typeof lists)[number]) => l.n,
    onToggle: vi.fn(async () => {}),
    onCreate: vi.fn(async () => {}),
    onChanged: vi.fn(async () => {}),
    ...over,
  };
  render(<ListPicker {...props} />);
  return props;
}

afterEach(cleanup);

describe('ListPicker', () => {
  it('shows a checkbox per list with its state and count', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: /Faves/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Later/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /Faves/ }).textContent).toContain('2');
  });

  it('toggling asks for the opposite state, then reports the change', async () => {
    const user = userEvent.setup();
    const p = setup();
    await user.click(screen.getByRole('checkbox', { name: /Later/ }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalledTimes(1));
    expect(p.onToggle).toHaveBeenCalledWith(lists[1], true);
    await user.click(screen.getByRole('checkbox', { name: /Faves/ }));
    expect(p.onToggle).toHaveBeenLastCalledWith(lists[0], false);
  });

  it('creates a list from the field, by button or Enter, and clears it', async () => {
    const user = userEvent.setup();
    const p = setup();
    const input = screen.getByLabelText('New list name') as HTMLInputElement;
    await user.type(input, '  Road trips ');
    await user.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith('Road trips'));
    await waitFor(() => expect(input.value).toBe(''));
    await user.type(input, 'More{Enter}');
    await waitFor(() => expect(p.onCreate).toHaveBeenLastCalledWith('More'));
  });

  it('does not submit a form around it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const p = {
      lists, isOn: () => false, onToggle: vi.fn(), onCreate: vi.fn(async () => {}),
    };
    render(<form onSubmit={onSubmit}><ListPicker {...p} /></form>);
    await user.type(screen.getByLabelText('New list name'), 'X{Enter}');
    await user.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the error when a toggle fails, and does not report a change', async () => {
    const user = userEvent.setup();
    const p = setup({ onToggle: vi.fn(async () => { throw new Error('List is full'); }) });
    await user.click(screen.getByRole('checkbox', { name: /Later/ }));
    expect(await screen.findByText('List is full')).toBeTruthy();
    expect(p.onChanged).not.toHaveBeenCalled();
  });

  it('says so when there are no lists', () => {
    setup({ lists: [], emptyText: 'Nothing here' });
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
