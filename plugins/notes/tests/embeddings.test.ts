/**
 * Notes embeddings + theme naming (no DB): chunking, pooling, batched
 * requests with fetch stubbed, and tolerant parsing of the LLM's theme name.
 */

import { describe, expect, it, vi } from 'vitest';
import { BATCH_SIZE, chunkNote, embedTexts, meanPool } from '../services/embeddings';
import { fallbackThemeName, nameTheme, parseThemeName } from '../services/themeNaming';

const CONFIG = { apiUrl: 'http://vllm:8001/v1', model: 'bge-m3', apiKey: 'k' };

describe('chunkNote', () => {
  it('keeps a short note whole, title first', () => {
    expect(chunkNote('Title', 'Body')).toEqual(['Title\n\nBody']);
    expect(chunkNote(null, '')).toEqual([]);
  });

  it('splits on paragraphs, then sentences, within the limit', () => {
    const para = 'Sentence one. '.repeat(30).trim();
    const chunks = chunkNote(null, `${para}\n\n${para}\n\n${'x'.repeat(250)}`, 200);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    expect(chunks.join('').replace(/\s/g, '')).toBe(`${para}${para}${'x'.repeat(250)}`.replace(/\s/g, ''));
  });
});

describe('meanPool', () => {
  it('averages normalized chunks into a unit vector', () => {
    const v = meanPool([[2, 0], [0, 5]]);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2);
    expect(v[1]).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('embedTexts', () => {
  it('batches requests and reorders by index', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body)) as { input: string[] };
      const data = input.map((text, index) => ({ index, embedding: [text.length, 1] })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const inputs = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => 'a'.repeat(i + 1));
    const out = await embedTexts(CONFIG, inputs, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.map((v) => v[0])).toEqual(inputs.map((s) => s.length));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://vllm:8001/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('surfaces endpoint errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('model not found', { status: 404 }));
    await expect(embedTexts(CONFIG, ['x'], fetchImpl as unknown as typeof fetch)).rejects.toThrow(/404.*model not found/);
  });
});

describe('theme naming', () => {
  const samples = [
    { title: 'A', excerpt: 'talked about mom', date: '2018-01-01', tags: ['Therapy', 'Family'] },
    { title: 'B', excerpt: 'mom again', date: '2018-02-01', tags: ['Therapy'] },
  ];

  it('parses JSON out of chatty or thinking replies', () => {
    expect(parseThemeName('<think>hmm {"label":"x"}</think>Sure! {"label": "Family Ties", "description": "Notes about family."}'))
      .toEqual({ label: 'Family Ties', description: 'Notes about family.' });
    expect(parseThemeName('no json')).toBeNull();
    expect(parseThemeName('{"label": ""}')).toBeNull();
  });

  it('falls back to the top tags, else a number', () => {
    expect(fallbackThemeName(samples, 3).label).toBe('Therapy & Family');
    expect(fallbackThemeName([], 3).label).toBe('Theme 3');
  });

  it('uses the LLM when configured and falls back when it fails', async () => {
    const llm = { api_url: 'x', model: 'm', reasoning_level: 'low', context_window: 32000, image_support: false };
    const ok = vi.fn(async () => '{"label": "Mom", "description": "About mom."}');
    expect(await nameTheme(llm, samples, 1, ok)).toEqual({ label: 'Mom', description: 'About mom.' });
    const bad = vi.fn(async () => {
      throw new Error('down');
    });
    expect((await nameTheme(llm, samples, 1, bad)).label).toBe('Therapy & Family');
    expect((await nameTheme(null, samples, 1, ok)).label).toBe('Therapy & Family');
  });
});
