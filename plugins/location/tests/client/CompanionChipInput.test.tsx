import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CompanionChipInput from '../../ui/CompanionChipInput';

const companionNamesMock = vi.fn();
vi.mock('../../../../client/src/api/client', () => ({
  checkins: {
    companionNames: (...args: unknown[]) => companionNamesMock(...args),
  },
}));

// Mirror the real endpoint's behavior: names are substring-filtered (case-
// insensitively) by the query server-side.
function setCompanionNames(names: string[]) {
  companionNamesMock.mockImplementation(
    (q?: string) =>
      names.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase())),
  );
}

beforeEach(() => {
  companionNamesMock.mockReset();
  setCompanionNames([]);
});

afterEach(() => {
  cleanup();
});

function renderInput(props: { value?: string[] } = {}) {
  const onChange = vi.fn();
  render(<CompanionChipInput value={props.value ?? []} onChange={onChange} />);
  return { onChange, input: screen.getByLabelText('Here with (companion names)') };
}

describe('CompanionChipInput', () => {
  it('renders selected names as removable chips', () => {
    renderInput({ value: ['Ada', 'Grace'] });
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Grace')).toBeTruthy();
  });

  it('removes a chip when its X button is clicked', async () => {
    const { onChange } = renderInput({ value: ['Ada', 'Grace'] });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));
    expect(onChange).toHaveBeenCalledWith(['Grace']);
  });

  it('commits typed text as a chip on Enter', async () => {
    const { onChange, input } = renderInput();
    await userEvent.type(input, 'Linus{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Linus']);
  });

  it('autocompletes from previously-entered names after the debounce', async () => {
    setCompanionNames(['Ada', 'Adam', 'Grace']);
    const { input } = renderInput({ value: [] });
    await userEvent.type(input, 'ad');
    await waitFor(() => expect(companionNamesMock).toHaveBeenCalledWith('ad', 50), { timeout: 1000 });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ada' })).toBeTruthy());
    // "Ada" and "Adam" both match "ad".
    expect(screen.getAllByRole('option').length).toBe(2);
  });

  it('excludes already-selected names from suggestions (case-insensitive)', async () => {
    setCompanionNames(['ada', 'brian']);
    renderInput({ value: ['Ada'] });
    const input = screen.getByLabelText('Here with (companion names)');
    await userEvent.type(input, 'a');
    await waitFor(() => expect(screen.queryByText('ada')).toBeNull(), { timeout: 1000 });
    await waitFor(() => expect(screen.getByRole('option', { name: 'brian' })).toBeTruthy());
  });

  it('removes the last chip with Backspace on an empty field', async () => {
    const { onChange } = renderInput({ value: ['Ada', 'Grace'] });
    const input = screen.getByLabelText('Here with (companion names)');
    await userEvent.click(input);
    await userEvent.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(['Ada']);
  });

  it('does not duplicate a name that already exists (case-insensitive)', async () => {
    const { onChange } = renderInput({ value: ['Ada'] });
    const input = screen.getByLabelText('Here with (companion names)');
    await userEvent.type(input, 'ada{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });
});
