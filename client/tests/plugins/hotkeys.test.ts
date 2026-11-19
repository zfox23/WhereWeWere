import { describe, expect, it } from 'vitest';
import { allClientPlugins } from '../../src/plugins/registry';

describe('plugin check-in hotkeys', () => {
  const withHotkeys = allClientPlugins().filter((p) => p.client.hotkey);

  it('are single characters', () => {
    for (const p of withHotkeys) {
      expect(p.client.hotkey, p.id).toMatch(/^.$/);
    }
  });

  it('are unique (case-insensitive), since a duplicate silently overrides another', () => {
    const owners = new Map<string, string[]>();
    for (const p of withHotkeys) {
      const key = p.client.hotkey!.toLowerCase();
      owners.set(key, [...(owners.get(key) ?? []), p.id]);
    }
    const duplicates = [...owners].filter(([, ids]) => ids.length > 1);
    expect(duplicates).toEqual([]);
  });

  it('cover every plugin that has a manual check-in', () => {
    const missing = allClientPlugins().filter((p) => !p.client.noCheckIn && !p.client.hotkey).map((p) => p.id);
    expect(missing).toEqual([]);
  });
});
