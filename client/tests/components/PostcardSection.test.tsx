import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostcardSection } from '../../src/components/PostcardSection';
import * as client from '../../src/api/client';

const llmApi = vi.hoisted(() => ({
  postcard: vi.fn(),
  postcardHistory: vi.fn(),
  getPostcard: vi.fn(),
  deletePostcard: vi.fn(),
}));

vi.mock('../../src/api/client', async (importOriginal) => {
  const mod = (await importOriginal()) as typeof client;
  return { ...mod, llm: llmApi };
});

const samplePostcard = {
  id: 'pc-1',
  from: '2024-06-03',
  to: '2024-07-02',
  addressed_to: 'Zach',
  sender_line: 'Zach, 2024-07',
  stamp_city: 'Lisbon',
  images: [
    { id: 'img-1', originalFileName: 'IMG_1.jpg', localDateTime: '2024-06-05T10:00:00Z' },
    { id: 'img-2', originalFileName: 'IMG_2.jpg', localDateTime: '2024-06-06T10:00:00Z' },
    { id: 'img-3', originalFileName: 'IMG_3.jpg', localDateTime: '2024-06-07T10:00:00Z' },
    { id: 'img-4', originalFileName: 'IMG_4.jpg', localDateTime: '2024-06-08T10:00:00Z' },
  ],
  message: 'Hello there.\n\nThis was a remarkable stretch of your life.',
  counts: { 'location check-ins': 10 },
  created_at: '2026-09-30T00:00:00Z',
};

const sampleHistory = [
  {
    id: 'pc-1',
    from: '2024-06-03',
    to: '2024-07-02',
    sender_line: 'Zach, 2024-07',
    stamp_city: 'Lisbon',
    message_preview: 'Hello there. This was a remarkable stretch.',
    image_ids: ['img-1', 'img-2'],
    created_at: '2026-09-30T00:00:00Z',
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PostcardSection', () => {
  it('shows the configure-an-LLM hint when the LLM is not configured', () => {
    llmApi.postcardHistory.mockResolvedValue([]);
    render(<PostcardSection llmConfig={{ configured: false, imageSupport: true }} immichUrl={null} />);
    expect(screen.getByText(/Configure an LLM/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Receive a Postcard/i })).toBeNull();
  });

  it('renders the button and the empty history when configured', async () => {
    llmApi.postcardHistory.mockResolvedValue([]);
    render(<PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl={null} />);
    expect(await screen.findByRole('button', { name: /Receive a Postcard/i })).toBeTruthy();
    expect(screen.getByText(/No postcards yet/i)).toBeTruthy();
  });

  it('generates a postcard, shows it, and adds it to the history list', async () => {
    llmApi.postcardHistory.mockResolvedValue([]);
    llmApi.postcard.mockResolvedValue(samplePostcard);

    const { container } = render(
      <PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl={null} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Receive a Postcard/i }));

    await waitFor(() => {
      expect(llmApi.postcard).toHaveBeenCalledTimes(1);
    });

    // Front of the postcard: addressed-to, sender line, stamp city, 4 images.
    // The sender line appears on both faces of the flip card (front rail +
    // back signature), so expect at least one.
    expect(screen.getAllByText('Zach, 2024-07').length).toBeGreaterThanOrEqual(1);
    // The stamp city appears in both the postcard stamp and the history row.
    expect(screen.getAllByText('Lisbon').length).toBeGreaterThanOrEqual(1);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThanOrEqual(4);

    // It now appears in the history list (and on the card itself).
    expect(screen.getAllByText('2024-06-03 → 2024-07-02').length).toBeGreaterThanOrEqual(1);

    // The message is on the (hidden) back face until flipped; the history
    // row also shows a truncated preview, so allow multiple matches.
    expect(screen.getAllByText(/remarkable stretch/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Immich link only when an immichUrl is provided', async () => {
    llmApi.postcardHistory.mockResolvedValue([]);
    llmApi.postcard.mockResolvedValue(samplePostcard);
    const { baseElement } = render(
      <PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl="https://immich.local" />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Receive a Postcard/i }));
    await waitFor(() => expect(llmApi.postcard).toHaveBeenCalledTimes(1));
    expect(baseElement.querySelector('a[href*="immich"]')).toBeTruthy();
  });

  it('flips the card to reveal the message on the back', async () => {
    llmApi.postcardHistory.mockResolvedValue([]);
    llmApi.postcard.mockResolvedValue(samplePostcard);
    const { container } = render(
      <PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl={null} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Receive a Postcard/i }));
    await waitFor(() => expect(llmApi.postcard).toHaveBeenCalledTimes(1));

    // Flip via the "Show back" button.
    await user.click(screen.getByRole('button', { name: /Show back/i }));
    // After flipping, the card is rotated 180deg.
    const inner = container.querySelector('[style*="preserve-3d"]') as HTMLElement;
    expect(inner.style.transform).toContain('rotateY(180deg)');
    // The flip button now offers the front again.
    expect(screen.getByRole('button', { name: /Show front/i })).toBeTruthy();
  });

  it('loads a postcard from the history list on click', async () => {
    llmApi.postcardHistory.mockResolvedValue(sampleHistory);
    llmApi.getPostcard.mockResolvedValue(samplePostcard);
    const { container } = render(
      <PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl={null} />
    );
    const user = userEvent.setup();

    // Wait for the history row to render.
    await screen.findByText('2024-06-03 → 2024-07-02');
    await user.click(screen.getByText('2024-06-03 → 2024-07-02'));

    await waitFor(() => expect(llmApi.getPostcard).toHaveBeenCalledWith('pc-1'));
    // The postcard now renders (sender line appears on both faces).
    expect(screen.getAllByText('Zach, 2024-07').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('img').length).toBeGreaterThanOrEqual(4);
  });

  it('removes a postcard from the history list on delete', async () => {
    llmApi.postcardHistory.mockResolvedValue(sampleHistory);
    llmApi.deletePostcard.mockResolvedValue({ message: 'Postcard deleted', id: 'pc-1' });
    render(<PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl={null} />);
    const user = userEvent.setup();

    const row = await screen.findByText('2024-06-03 → 2024-07-02');
    await user.click(screen.getByRole('button', { name: 'Delete this postcard' }));

    await waitFor(() => {
      expect(llmApi.deletePostcard).toHaveBeenCalledWith('pc-1');
    });
    expect(screen.queryByText(row.textContent!)).toBeNull();
    expect(screen.getByText(/No postcards yet/i)).toBeTruthy();
  });

  it('shows an error and allows retrying on failure', async () => {
    llmApi.postcardHistory.mockResolvedValue([]);
    llmApi.postcard.mockRejectedValue(new Error('LLM request failed (500)'));
    render(<PostcardSection llmConfig={{ configured: true, imageSupport: true }} immichUrl={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Receive a Postcard/i }));
    expect(await screen.findByText(/LLM request failed \(500\)/i)).toBeTruthy();
    // The button is enabled again so the user can retry.
    expect((screen.getByRole('button', { name: /Receive a Postcard/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
