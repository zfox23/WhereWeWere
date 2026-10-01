import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLlm, type LlmSettings } from '../../src/services/llmClient';

const llm: LlmSettings = {
  api_url: 'http://llm.test',
  model: 'test-model',
  reasoning_level: 'medium',
  context_window: 32000,
  image_support: false,
};

function mockCompletion(content: string | null, finishReason = 'stop') {
  return new Response(
    JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callLlm', () => {
  it('returns the content on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockCompletion('Hello there.')));
    const out = await callLlm(llm, 'sys', 'user', 1024);
    expect(out).toBe('Hello there.');
  });

  it('retries with a larger max_tokens when a reasoning model returns empty content at finish_reason length', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCompletion(null, 'length'))
      .mockResolvedValueOnce(mockCompletion('Finally some text.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await callLlm(llm, 'sys', 'user', 1024);
    expect(out).toBe('Finally some text.');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { max_tokens: number };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as { max_tokens: number };
    expect(secondBody.max_tokens).toBeGreaterThan(firstBody.max_tokens);
  });

  it('caps the retry budget at 16384 tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCompletion(null, 'length'))
      .mockResolvedValueOnce(mockCompletion('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await callLlm(llm, 'sys', 'user', 8192);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as { max_tokens: number };
    expect(secondBody.max_tokens).toBe(16384);
  });

  it('throws when the response is empty on every attempt', async () => {
    // Fresh Response per call: a Response body can only be read once.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(mockCompletion(null, 'length'))));
    await expect(callLlm(llm, 'sys', 'user', 1024)).rejects.toThrow('LLM returned an empty response.');
  });

  it('propagates non-OK responses as errors (no retry)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 })
      )
    );
    await expect(callLlm(llm, 'sys', 'user', 1024)).rejects.toThrow(/LLM request failed/);
  });
});
