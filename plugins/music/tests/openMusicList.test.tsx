import { describe, expect, it } from 'vitest';
import { openMusicList } from '../ui/listTitle';

describe('openMusicList', () => {
  it('puts the list in the URL on the Lists subtab and tells listeners', () => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicPeriod=all&musicSection=library&q=x');
    let fired = 0;
    const onPop = () => fired++;
    window.addEventListener('popstate', onPop);
    openMusicList('abc');
    window.removeEventListener('popstate', onPop);
    const p = new URLSearchParams(window.location.search);
    expect([p.get('musicSection'), p.get('musicList'), p.get('musicPeriod')]).toEqual(['lists', 'abc', 'all']);
    expect(fired).toBe(1);
  });
});
