import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSubmitHotkey, useSubmitHotkey } from '../../src/hooks/useSubmitHotkey';

afterEach(cleanup);

function Harness({ onSubmit, enabled = true, onFieldKey }: { onSubmit: () => void; enabled?: boolean; onFieldKey?: () => void }) {
  useSubmitHotkey(onSubmit, enabled);
  return (
    <input
      aria-label="field"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onFieldKey?.();
        }
      }}
    />
  );
}

const key = (init: Partial<KeyboardEventInit>) => ({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, ...init });

describe('isSubmitHotkey', () => {
  it('accepts Ctrl+Enter and ⌘+Enter only', () => {
    expect(isSubmitHotkey(key({ ctrlKey: true }))).toBe(true);
    expect(isSubmitHotkey(key({ metaKey: true }))).toBe(true);
    expect(isSubmitHotkey(key({}))).toBe(false);
    expect(isSubmitHotkey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSubmitHotkey({ ...key({ ctrlKey: true }), key: 'a' })).toBe(false);
  });
});

describe('useSubmitHotkey', () => {
  it('submits from anywhere on the page', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('wins over a field that handles Enter itself', () => {
    const onSubmit = vi.fn();
    const onFieldKey = vi.fn();
    const { getByLabelText } = render(<Harness onSubmit={onSubmit} onFieldKey={onFieldKey} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onFieldKey).not.toHaveBeenCalled();
  });

  it('ignores plain Enter, Shift+Enter and key repeat', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true, repeat: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} enabled={false} />);
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
