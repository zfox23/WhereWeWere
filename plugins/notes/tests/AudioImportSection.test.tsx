import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioImportSection } from '../ui/AudioImportSection';
import { notesAudioImport, type AudioImportRow } from '../ui/api';
import { uploadBlob } from '../ui/audio/uploader';

vi.mock('../ui/api', async (orig) => {
  const actual = await orig<typeof import('../ui/api')>();
  return {
    ...actual,
    notesAudioImport: { plan: vi.fn(), addNote: vi.fn(), finish: vi.fn() },
  };
});
vi.mock('../ui/audio/uploader', () => ({ uploadBlob: vi.fn() }));
// A checksum that depends on the file, without reading bytes.
vi.mock('../ui/audio/sha256', () => ({
  sha256Blob: async (b: File) => `${b.name.length}${b.size}`.padEnd(64, 'f').slice(0, 64),
}));
vi.mock('../ui/TimezoneInput', () => ({ TimezoneInput: ({ id }: { id: string }) => <input id={id} defaultValue="UTC" readOnly /> }));
vi.mock('../ui/TagChipInput', () => ({
  default: ({ onChange }: { onChange: (v: string[]) => void }) => <button onClick={() => onChange(['Voice Memos'])}>add tag</button>,
}));

const file = (name: string, size = 100, lastModified = 1_700_000_000_000) =>
  new File([new Uint8Array(size)], name, { type: 'audio/mp4', lastModified });

const planFor = (files: { name: string; size: number }[]) => ({
  total: files.length,
  selected: 0,
  fallback_count: files.length,
  duplicate_count: 0,
  rows: files.map((f, index): AudioImportRow => ({
    index, filename: f.name, mime: 'audio/mp4', bytes: f.size,
    title: f.name.replace(/\.[^.]+$/, ''), checked_in_at: '2024-01-01T10:00:00.000Z', timezone: 'UTC', local_date: '2024-01-01',
    time_source: 'filename', tz_source: 'fallback',
    duplicate: f.name.includes('dup') ? 'checksum' : null,
    selected_default: !f.name.includes('dup'),
    error: null,
  })),
});

const renderSection = () => render(<MemoryRouter><AudioImportSection /></MemoryRouter>);
const stage = (...files: File[]) => userEvent.upload(screen.getByLabelText('Audio files'), files);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notesAudioImport.plan).mockImplementation(async (files) => planFor(files));
  vi.mocked(notesAudioImport.addNote).mockImplementation(async () => ({ note_id: 'n', already: false }));
  vi.mocked(notesAudioImport.finish).mockImplementation(async (ids) => ({ released: ids.length, transcription_configured: true }));
  let n = 0;
  vi.mocked(uploadBlob).mockImplementation(async () => `audio-${++n}`);
});
afterEach(cleanup);

describe('AudioImportSection', () => {
  it('stages drops in batches: each adds to one list, and the plan covers everything staged', async () => {
    renderSection();
    await stage(file('a.m4a'), file('b.m4a'));
    await screen.findByText('2 files staged');
    await waitFor(() => expect(notesAudioImport.plan).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'a.m4a' })]), 'UTC'));

    await stage(file('c.m4a'));
    await screen.findByText('3 files staged');
    await waitFor(() => expect(vi.mocked(notesAudioImport.plan).mock.lastCall![0]).toHaveLength(3));
    expect(screen.getAllByRole('checkbox', { name: /^Import / })).toHaveLength(3);
    expect(uploadBlob).not.toHaveBeenCalled(); // nothing uploads until Import
  });

  it('sends each file’s name, size, modified time and checksum for planning, but no audio', async () => {
    renderSection();
    await stage(file('a.m4a', 100, 1234567));
    await waitFor(() => expect(notesAudioImport.plan).toHaveBeenCalled());
    const sent = vi.mocked(notesAudioImport.plan).mock.lastCall![0][0];
    expect(sent).toMatchObject({ name: 'a.m4a', size: 100, last_modified: 1234567 });
    expect(sent.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not stage the same file twice', async () => {
    renderSection();
    await stage(file('a.m4a'));
    await screen.findByText('1 file staged');
    await stage(file('a.m4a'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('1 file staged')).toBeInTheDocument();
  });

  it('takes a dropped folder, walking it and ignoring what is not audio', async () => {
    renderSection();
    const dir = {
      isFile: false, isDirectory: true, name: 'Memos',
      createReader: () => {
        let done = false;
        return { readEntries: (ok: (e: unknown[]) => void) => {
          if (done) return ok([]);
          done = true;
          ok([
            { isFile: true, isDirectory: false, name: '2023-04-05 14.30.59 Walk.m4a', file: (ok2: (f: File) => void) => ok2(file('2023-04-05 14.30.59 Walk.m4a')) },
            { isFile: true, isDirectory: false, name: 'readme.txt', file: (ok2: (f: File) => void) => ok2(new File(['x'], 'readme.txt', { type: 'text/plain' })) },
          ]);
        } };
      },
    };
    fireEvent.drop(screen.getByTestId('audio-import-drop'), {
      dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => dir, getAsFile: () => null }], files: [] },
    });
    await screen.findByText('1 file staged');
    expect(screen.getByText('1 unsupported file skipped')).toBeInTheDocument();
    expect(await screen.findByText(/Memos\/2023-04-05 14\.30\.59 Walk\.m4a/)).toBeInTheDocument();
  });

  it('ticks everything except duplicates, and lets you change it', async () => {
    renderSection();
    await stage(file('a.m4a'), file('dup.m4a'));
    const dup = await screen.findByRole('checkbox', { name: 'Import dup.m4a' });
    expect(screen.getByRole('checkbox', { name: 'Import a.m4a' })).toBeChecked();
    expect(dup).not.toBeChecked();
    expect(screen.getByText('Already imported (identical audio)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import 1 file$/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Import a.m4a' }));
    expect(screen.getByRole('button', { name: /Import 0 files/ })).toBeDisabled();
  });

  it('imports one by one (held, reusing earlier uploads), tags every note, and starts transcription only at the end', async () => {
    renderSection();
    await stage(file('a.m4a'), file('b.m4a'));
    await screen.findByText('2 files staged');
    await userEvent.click(await screen.findByRole('button', { name: 'add tag' }));
    await userEvent.click(screen.getByRole('button', { name: /Import 2 files/ }));

    await waitFor(() => expect(notesAudioImport.finish).toHaveBeenCalledTimes(1));
    expect(uploadBlob).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadBlob).mock.calls[0][0]).toMatchObject({ filename: 'a.m4a', mime: 'audio/mp4', defer: true, reuse: true });
    expect(notesAudioImport.addNote).toHaveBeenNthCalledWith(1, {
      audio_id: 'audio-1', title: 'a', checked_in_at: '2024-01-01T10:00:00.000Z', timezone: 'UTC', filename: 'a.m4a', tags: ['Voice Memos'],
    });
    expect(notesAudioImport.addNote).toHaveBeenCalledTimes(2);
    expect(notesAudioImport.finish).toHaveBeenCalledWith(['audio-1', 'audio-2']);
    // The transcriber is released after every file was uploaded and had its note.
    const lastAdd = Math.max(...vi.mocked(notesAudioImport.addNote).mock.invocationCallOrder);
    expect(vi.mocked(notesAudioImport.finish).mock.invocationCallOrder[0]).toBeGreaterThan(lastAdd);

    await screen.findByText(/Imported 2 notes/);
    expect(screen.getByText(/Transcription of 2 files has started/)).toBeInTheDocument();
    expect(screen.queryByText(/files? staged/)).toBeNull(); // done files leave the list
  });

  it('keeps going when one file fails, lists it, leaves it staged for a retry, and only releases what succeeded', async () => {
    let n = 0;
    vi.mocked(uploadBlob).mockImplementation(async (u) => {
      if (u.filename === 'bad.m4a') throw new Error('Server said no');
      return `audio-${++n}`;
    });
    renderSection();
    await stage(file('a.m4a'), file('bad.m4a'), file('c.m4a'));
    await screen.findByText('3 files staged');
    await userEvent.click(await screen.findByRole('button', { name: /Import 3 files/ }));

    await screen.findByText(/Imported 2 notes/);
    expect(screen.getByText(/bad\.m4a: Server said no/)).toBeInTheDocument();
    expect(notesAudioImport.finish).toHaveBeenCalledWith(['audio-1', 'audio-2']);
    expect(screen.getByText('1 file staged')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Import bad.m4a' })).toBeInTheDocument();
  });

  it('points to the integration settings when transcription is not set up', async () => {
    vi.mocked(notesAudioImport.finish).mockResolvedValue({ released: 0, transcription_configured: false });
    renderSection();
    await stage(file('a.m4a'));
    await userEvent.click(await screen.findByRole('button', { name: /Import 1 file$/ }));
    expect(await screen.findByText(/Set up transcription in Settings > Integrations/)).toBeInTheDocument();
  });

  it('shows how each file will be dated and flags where the time came from', async () => {
    vi.mocked(notesAudioImport.plan).mockImplementation(async (files) => {
      const p = planFor(files);
      p.rows[0].time_source = 'default_evening';
      return p;
    });
    renderSection();
    await stage(file('2023-04-05 Walk.m4a'));
    const row = (await screen.findByRole('checkbox', { name: /Import 2023-04-05 Walk\.m4a/ })).closest('tr')!;
    expect(within(row).getByText('8pm (no matching file time)')).toBeInTheDocument();
    expect(within(row).getByText('fallback')).toBeInTheDocument();
  });

  it('clears the list', async () => {
    renderSection();
    await stage(file('a.m4a'));
    await screen.findByText('1 file staged');
    await userEvent.click(screen.getByRole('button', { name: /Clear list/ }));
    expect(screen.queryByText(/files? staged/)).toBeNull();
  });
});
