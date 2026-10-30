import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteCheckIn from '../ui/NoteCheckIn';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  tags: vi.fn(),
}));

vi.mock('../ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/api')>()),
  notes: api,
}));

vi.mock('../../../client/src/api/client', () => ({
  companions: { names: vi.fn().mockResolvedValue([]), photoUrl: () => '' },
  settings: { get: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../../client/src/utils/slugify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../client/src/utils/slugify')>()),
  deviceTimezone: () => 'America/Chicago',
}));

const DRAFT_KEY = 'wwp:notes:draft:new';

function renderForm(props: Partial<Parameters<typeof NoteCheckIn>[0]> = {}) {
  const onCreated = vi.fn();
  render(
    <MemoryRouter>
      <NoteCheckIn onCreated={onCreated} onUpdated={vi.fn()} {...props} />
    </MemoryRouter>,
  );
  return { onCreated };
}

describe('NoteCheckIn', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.tags.mockResolvedValue([{ id: 't1', name: 'Journaling', color: '#2a78d6', note_count: 3, word_count: 10, last_used_at: null }]);
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('saves the note in the chosen zone with tags', async () => {
    api.create.mockResolvedValue({ id: 'n1' });
    const { onCreated } = renderForm({ dateParam: '2017-10-15' });
    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: 'Night with Jason' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '# Hello' } });
    await userEvent.type(screen.getByLabelText('Tags'), 'Dream Journal{Enter}');
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Asia/Tokyo' } });
    await userEvent.click(screen.getByRole('button', { name: /Save note/ }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('n1'), { timeout: 3000 });
    expect(api.create).toHaveBeenCalledWith({
      title: 'Night with Jason',
      body: '# Hello',
      checked_in_at: '2017-10-15T11:00:00.000Z', // 20:00 in Tokyo
      checkin_timezone: 'Asia/Tokyo',
      tags: ['Dream Journal'],
      companions: [],
    });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('refuses an invalid zone or an empty note', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: /Save note/ }));
    expect(await screen.findByText(/Write something/)).toBeTruthy();
    const tz = screen.getByLabelText('Time zone');
    await userEvent.clear(tz);
    await userEvent.type(tz, 'Mars/Base');
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'x' } });
    await userEvent.click(screen.getByRole('button', { name: /Save note/ }));
    expect(await screen.findByText(/valid time zone/)).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('autosaves a draft and offers it back', async () => {
    const first = renderForm();
    void first;
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Unsaved thoughts' } });
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toContain('Unsaved thoughts'), { timeout: 2000 });
    cleanup();

    renderForm();
    expect(screen.getByText(/unsaved draft/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
    expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('Unsaved thoughts');
  });

  it('works when storage is blocked', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'still fine' } });
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText(/unsaved draft/)).toBeNull();
    spy.mockRestore();
    set.mockRestore();
  });

  it('continues a list on Enter and previews markdown', async () => {
    renderForm();
    const editor = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
    await userEvent.type(editor, '- one{Enter}two');
    expect(editor.value).toBe('- one\n- two');
    await userEvent.click(screen.getByRole('tab', { name: /Preview/ }));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('keeps the stored instant and zone when editing other fields', async () => {
    api.get.mockResolvedValue({
      id: 'n1', title: 'Old', body: 'Body', checked_in_at: '2017-10-15T11:00:00.000Z', checkin_timezone: 'Asia/Tokyo',
      source: 'manual', source_filename: null, word_count: 1, created_at: '', updated_at: '',
      tags: [{ id: 't1', name: 'Journaling', color: '#2a78d6' }], companions: [], themes: [],
    });
    api.update.mockResolvedValue({});
    renderForm({ editId: 'n1' });
    const title = await screen.findByLabelText('Title (optional)');
    expect((screen.getByLabelText('Date & Time') as HTMLInputElement).value).toBe('2017-10-15T20:00');
    await userEvent.clear(title);
    await userEvent.type(title, 'New');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1]).toMatchObject({
      title: 'New', checked_in_at: '2017-10-15T11:00:00.000Z', checkin_timezone: 'Asia/Tokyo', tags: ['Journaling'],
    });
  });
});
