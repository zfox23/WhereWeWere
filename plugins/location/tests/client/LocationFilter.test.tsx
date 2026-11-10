import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import LocationFilter from '../../ui/LocationFilter';

describe('LocationFilter', () => {
  afterEach(() => {
    cleanup();
  });
  it('does not wipe typed input on blur if no exact match is found', async () => {
    const user = userEvent.setup();
    const onSetCategory = vi.fn();
    const onSetCountry = vi.fn();

    render(
      <LocationFilter
        included={true}
        filtersDisabled={false}
        sectionDisabled={false}
        typeToggleDisabled={false}
        category=""
        country=""
        categoryOptions={['Restaurant', 'Cafe', 'Bar']}
        countryOptions={['United States', 'Japan', 'France']}
        onToggleIncluded={vi.fn()}
        onSetCategory={onSetCategory}
        onSetCountry={onSetCountry}
      />
    );

    const categoryInput = screen.getByPlaceholderText('Restaurant, Home...');
    await user.type(categoryInput, 'Rest');
    fireEvent.blur(categoryInput);

    expect(categoryInput).toHaveValue('Rest');

    const countryInput = screen.getByPlaceholderText('United States, Espana...');
    await user.type(countryInput, 'Unit');
    fireEvent.blur(countryInput);

    expect(countryInput).toHaveValue('Unit');
  });

  it('normalizes to exact match casing on blur when matched', async () => {
    const user = userEvent.setup();
    const onSetCategory = vi.fn();

    render(
      <LocationFilter
        included={true}
        filtersDisabled={false}
        sectionDisabled={false}
        typeToggleDisabled={false}
        category=""
        country=""
        categoryOptions={['Restaurant', 'Cafe', 'Bar']}
        countryOptions={['United States', 'Japan']}
        onToggleIncluded={vi.fn()}
        onSetCategory={onSetCategory}
        onSetCountry={vi.fn()}
      />
    );

    const categoryInput = screen.getByPlaceholderText('Restaurant, Home...');
    await user.type(categoryInput, 'restaurant');
    fireEvent.blur(categoryInput);

    expect(categoryInput).toHaveValue('Restaurant');
    expect(onSetCategory).toHaveBeenCalledWith('Restaurant');
  });
});
