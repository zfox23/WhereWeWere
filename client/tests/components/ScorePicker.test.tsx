import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScorePicker from '../../src/components/ScorePicker';

afterEach(() => {
  cleanup();
});

describe('ScorePicker', () => {
  it('renders 4 star buttons and a "No rating" hint when value is 0', () => {
    render(<ScorePicker value={0} onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByText('No rating')).toBeTruthy();
  });

  it('sets the score when a star is clicked', async () => {
    const onChange = vi.fn();
    render(<ScorePicker value={0} onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '3 stars' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('clears the score when the current top star is clicked again', async () => {
    const onChange = vi.fn();
    render(<ScorePicker value={3} onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '3 stars' }));

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('shows the value label when rated', () => {
    render(<ScorePicker value={4} onChange={vi.fn()} />);
    expect(screen.getByText('4/4')).toBeTruthy();
    expect(screen.queryByText('No rating')).toBeNull();
  });

  it('marks stars at or below the value as checked', () => {
    render(<ScorePicker value={2} onChange={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('aria-checked')).toBe('false');
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(radios[2].getAttribute('aria-checked')).toBe('false');
    expect(radios[3].getAttribute('aria-checked')).toBe('false');
  });

  it('does not emit changes while disabled', async () => {
    const onChange = vi.fn();
    render(<ScorePicker value={0} onChange={onChange} disabled />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '2 stars' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
