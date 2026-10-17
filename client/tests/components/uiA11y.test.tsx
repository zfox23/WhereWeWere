import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Heatmap } from '../../src/components/Stats';
import IconPicker from '../../src/components/IconPicker';
import { BackButton } from '../../src/components/BackButton';

afterEach(cleanup);

describe('Heatmap', () => {
  const days = [
    { date: '2024-03-05', count: 2 },
    { date: '2024-03-06', count: 0 },
  ];

  it('renders days with check-ins as buttons that report their date', async () => {
    const onDayClick = vi.fn();
    render(<Heatmap days={days} year={2024} onDayClick={onDayClick} />);
    const button = screen.getByRole('button', { name: '2024-03-05: 2 check-ins' });
    await userEvent.click(button);
    expect(onDayClick).toHaveBeenCalledWith('2024-03-05');
    // Empty days are not interactive.
    expect(screen.queryByRole('button', { name: /2024-03-06/ })).toBeNull();
  });

  it('labels every month once', () => {
    render(<Heatmap days={days} year={2024} />);
    for (const m of ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) {
      expect(screen.getAllByText(m)).toHaveLength(1);
    }
  });
});

describe('IconPicker', () => {
  it('is a labelled modal dialog that closes on Escape', async () => {
    const onClose = vi.fn();
    render(<IconPicker onChange={() => {}} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Select Icon' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Tab focus inside the dialog', async () => {
    render(
      <>
        <button>outside</button>
        <IconPicker onChange={() => {}} onClose={() => {}} />
      </>,
    );
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('BackButton', () => {
  function Detail() {
    return <BackButton />;
  }
  function Shell() {
    const navigate = useNavigate();
    return <button onClick={() => navigate('/detail')}>open</button>;
  }

  it('goes home when the page is the first history entry (deep link / new tab)', async () => {
    render(
      <MemoryRouter initialEntries={['/detail']}>
        <Routes>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/detail" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('home page')).toBeTruthy();
  });

  it('goes back one entry when there is in-app history', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Shell />} />
          <Route path="/detail" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('button', { name: 'open' })).toBeTruthy();
  });
});
