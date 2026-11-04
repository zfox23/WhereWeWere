import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entryScriptPathFromHtml,
  isUserEditing,
  reloadWhenIdle,
  shouldReloadForBuild,
} from '../../src/utils/swUpdate';

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

describe('entryScriptPathFromHtml', () => {
  const origin = 'https://app.example';

  it('finds the hashed module entry script', () => {
    const html =
      '<!doctype html><html><head><script>var x=1</script>' +
      '<script type="module" crossorigin src="/assets/index-fd-6EJid.js"></script></head></html>';
    expect(entryScriptPathFromHtml(html, origin)).toBe('/assets/index-fd-6EJid.js');
  });

  it('normalises absolute URLs to a path', () => {
    const html = '<script type="module" src="https://app.example/assets/index-1.js"></script>';
    expect(entryScriptPathFromHtml(html, origin)).toBe('/assets/index-1.js');
  });

  it('is null when there is no module script', () => {
    expect(entryScriptPathFromHtml('<p>Bad gateway</p>', origin)).toBeNull();
  });
});

describe('shouldReloadForBuild', () => {
  it('reloads when the server has a different build', () => {
    expect(shouldReloadForBuild('/assets/a.js', '/assets/b.js', null)).toBe(true);
  });

  it('does not reload when already current', () => {
    expect(shouldReloadForBuild('/assets/a.js', '/assets/a.js', null)).toBe(false);
  });

  it('does not reload when either build is unknown', () => {
    expect(shouldReloadForBuild(null, '/assets/b.js', null)).toBe(false);
    expect(shouldReloadForBuild('/assets/a.js', null, null)).toBe(false);
  });

  it('does not retry a build a previous reload failed to reach', () => {
    expect(shouldReloadForBuild('/assets/a.js', '/assets/b.js', '/assets/b.js')).toBe(false);
    expect(shouldReloadForBuild('/assets/a.js', '/assets/c.js', '/assets/b.js')).toBe(true);
  });
});
