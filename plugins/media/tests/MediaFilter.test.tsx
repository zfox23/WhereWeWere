import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaFilter from '../ui/MediaFilter';
import { MEDIA_SUBTYPE_LIST } from '../utils/media';

const baseProps = {
  included: true,
  filtersDisabled: false,
  sectionDisabled: false,
  typeToggleDisabled: false,
  mediaSubtypes: '',
};

afterEach(() => {
  cleanup();
});

describe('MediaFilter', () => {
  it('renders the Media include toggle and all five subtype pills', () => {
    render(<MediaFilter {...baseProps} onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy();
    for (const label of ['Movies', 'TV Shows', 'Games', 'Books', 'Board Games']) {
      expect(screen.getByRole('button', { name: label, pressed: false })).toBeTruthy();
    }
  });

  it('calls onToggleIncluded when the Media toggle changes', async () => {
    const onToggleIncluded = vi.fn();
    render(<MediaFilter {...baseProps} onToggleIncluded={onToggleIncluded} onSetMediaSubtypes={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Media' }));

    expect(onToggleIncluded).toHaveBeenCalledTimes(1);
  });

  it('collapses subtype options when the Media type is not included', () => {
    render(
      <MediaFilter {...baseProps} included={false} onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Movies' })).toBeNull();
  });

  it('adds and removes subtypes in canonical order', async () => {
    const onSetMediaSubtypes = vi.fn();
    const { rerender } = render(
      <MediaFilter {...baseProps} mediaSubtypes="" onToggleIncluded={vi.fn()} onSetMediaSubtypes={onSetMediaSubtypes} />,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Board Games' }));
    expect(onSetMediaSubtypes).toHaveBeenLastCalledWith('board_game');

    onSetMediaSubtypes.mockClear();
    rerender(
      <MediaFilter {...baseProps} mediaSubtypes="board_game" onToggleIncluded={vi.fn()} onSetMediaSubtypes={onSetMediaSubtypes} />,
    );

    await user.click(screen.getByRole('button', { name: 'Movies' }));
    // Canonical order: movie comes before board_game
    expect(onSetMediaSubtypes).toHaveBeenLastCalledWith('movie,board_game');

    onSetMediaSubtypes.mockClear();
    rerender(
      <MediaFilter {...baseProps} mediaSubtypes={MEDIA_SUBTYPE_LIST.join(',')} onToggleIncluded={vi.fn()} onSetMediaSubtypes={onSetMediaSubtypes} />,
    );

    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(onSetMediaSubtypes).toHaveBeenLastCalledWith(
      MEDIA_SUBTYPE_LIST.filter((s) => s !== 'game').join(','),
    );
  });

  it('disables subtype pills when the section is disabled', () => {
    render(
      <MediaFilter {...baseProps} sectionDisabled onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Books' })).toHaveAttribute('disabled');
  });

  it('disables the include toggle when type toggling is disabled and explains why', () => {
    render(
      <MediaFilter {...baseProps} typeToggleDisabled filtersDisabled onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Media' })).toHaveAttribute('disabled');
    expect(screen.getByText(/clear other type filters/i)).toBeTruthy();
  });
});
