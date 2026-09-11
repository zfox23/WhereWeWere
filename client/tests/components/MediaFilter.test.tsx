import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaFilter from '../../src/components/filters/MediaFilter';
import { MEDIA_SUBTYPE_LIST } from '../../src/utils/media';

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
  it('renders the Media include toggle and all five subtype checkboxes', () => {
    render(<MediaFilter {...baseProps} onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Media' })).toBeTruthy();
    for (const label of ['Movie', 'TV Show', 'Game', 'Book', 'Board Game']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeTruthy();
    }
  });

  it('calls onToggleIncluded when the Media toggle changes', async () => {
    const onToggleIncluded = vi.fn();
    render(<MediaFilter {...baseProps} onToggleIncluded={onToggleIncluded} onSetMediaSubtypes={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Media' }));

    expect(onToggleIncluded).toHaveBeenCalledTimes(1);
  });

  it('adds and removes subtypes in canonical order', async () => {
    const onSetMediaSubtypes = vi.fn();
    const { rerender } = render(
      <MediaFilter {...baseProps} mediaSubtypes="" onToggleIncluded={vi.fn()} onSetMediaSubtypes={onSetMediaSubtypes} />,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole('checkbox', { name: 'Board Game' }));
    expect(onSetMediaSubtypes).toHaveBeenLastCalledWith('board_game');

    onSetMediaSubtypes.mockClear();
    rerender(
      <MediaFilter {...baseProps} mediaSubtypes="board_game" onToggleIncluded={vi.fn()} onSetMediaSubtypes={onSetMediaSubtypes} />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Movie' }));
    // Canonical order: movie comes before board_game
    expect(onSetMediaSubtypes).toHaveBeenLastCalledWith('movie,board_game');

    onSetMediaSubtypes.mockClear();
    rerender(
      <MediaFilter {...baseProps} mediaSubtypes={MEDIA_SUBTYPE_LIST.join(',')} onToggleIncluded={vi.fn()} onSetMediaSubtypes={onSetMediaSubtypes} />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Game' }));
    expect(onSetMediaSubtypes).toHaveBeenLastCalledWith(
      MEDIA_SUBTYPE_LIST.filter((s) => s !== 'game').join(','),
    );
  });

  it('disables subtype checkboxes when the section is disabled', () => {
    render(
      <MediaFilter {...baseProps} sectionDisabled onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Movie' })).toHaveAttribute('disabled');
    expect(screen.getByRole('checkbox', { name: 'Book' })).toHaveAttribute('disabled');
  });

  it('disables the include toggle when type toggling is disabled and explains why', () => {
    render(
      <MediaFilter {...baseProps} typeToggleDisabled filtersDisabled onToggleIncluded={vi.fn()} onSetMediaSubtypes={vi.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Media' })).toHaveAttribute('disabled');
    expect(screen.getByText(/clear other type filters/i)).toBeTruthy();
  });
});
