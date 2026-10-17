import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUserEditing, reloadWhenIdle } from '../../src/utils/swUpdate';

describe('isUserEditing', () => {
  it('is true on check-in form pages and edit URLs', () => {
    expect(isUserEditing('/location-check-in', '', null)).toBe(true);
    expect(isUserEditing('/media-check-in/movie/1/x', '', null)).toBe(true);
    expect(isUserEditing('/checkins/scuba/abc', '?edit=abc', null)).toBe(true);
  });

  it('is true while a text field has focus', () => {
    expect(isUserEditing('/', '', document.createElement('input'))).toBe(true);
    expect(isUserEditing('/', '', document.createElement('textarea'))).toBe(true);
  });

  it('is false on a plain page with nothing focused', () => {
    expect(isUserEditing('/', '', document.body)).toBe(false);
    expect(isUserEditing('/profile', '?tab=x', null)).toBe(false);
  });
});

describe('reloadWhenIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads immediately when the user is idle', () => {
    const reload = vi.fn();
    reloadWhenIdle(reload, () => false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits until editing stops, then reloads once', () => {
    const reload = vi.fn();
    let editing = true;
    reloadWhenIdle(reload, () => editing, 1000);
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
    editing = false;
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled', () => {
    const reload = vi.fn();
    const cancel = reloadWhenIdle(reload, () => true, 1000);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });
});
