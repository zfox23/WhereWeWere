import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MusicReflectionCard } from '../ui/MusicReflectionCard';

afterEach(cleanup);

describe('MusicReflectionCard', () => {
  it('lists tracks with counts and links to that day\'s music on Home', () => {
    render(
      <MemoryRouter>
        <MusicReflectionCard
          date="2023-05-01"
          tracks={[
            { title: 'Song A', artists: ['X', 'Y'], count: 7 },
            { title: 'Song B', artists: ['Z'], count: 2 },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('7x')).toBeTruthy();
    expect(screen.getByText('2x')).toBeTruthy();
    expect(screen.getByText(/Song A/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/?from=2023-05-01&to=2023-05-01&music=sessions');
  });

  it('renders nothing without tracks', () => {
    const { container } = render(
      <MemoryRouter>
        <MusicReflectionCard date="2023-05-01" tracks={[]} />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
  });
});
