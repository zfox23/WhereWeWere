import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MoodCheckInPage from '../../ui/MoodCheckIn';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  groups: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock('../../ui/api', () => ({
  moodCheckins: { create: mocks.create, update: mocks.update, get: mocks.get, delete: mocks.remove },
  moodActivities: { groups: mocks.groups },
}));
vi.mock('../../../../client/src/plugins/api', () => ({
  plugins: { settings: { get: mocks.settingsGet } },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/mood-check-in']}>
      <MoodCheckInPage />
    </MemoryRouter>,
  );
}

describe('Mood check-in Ctrl/⌘+Enter', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.groups.mockResolvedValue([]);
    mocks.settingsGet.mockResolvedValue({});
    mocks.create.mockResolvedValue({ id: 'm1' });
  });
  afterEach(cleanup);

  it('submits after picking a mood with a number key, with focus outside every field', async () => {
    renderPage();
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ mood: 4 }));
  });

  it('submits with ⌘+Enter from the activity filter', async () => {
    renderPage();
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(screen.getByPlaceholderText('Filter by activity or group...'), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  });

  it('does nothing before a mood is picked', () => {
    renderPage();
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('saves once when the shortcut is pressed twice quickly', async () => {
    let resolve!: (v: unknown) => void;
    mocks.create.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    fireEvent.keyDown(window, { key: '3' });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    resolve({ id: 'm1' });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  });
});
