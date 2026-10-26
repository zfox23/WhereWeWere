/**
 * Pick which lists a song or album is on, or start a new list with it.
 * Toggling a list adds or removes immediately.
 */

import { X } from 'lucide-react';
import { ListPicker as SharedListPicker } from '../../../client/src/components/lists/ListPicker';
import { music } from './api';
import { targetItemKey, type ListTarget, type MusicList } from './types';
import { useMusicLists } from './useMusicLists';

export function ListPicker({ target, label, onClose }: { target: ListTarget; label: string; onClose: () => void }) {
  const { lists, loaded, refresh } = useMusicLists();
  const itemKey = targetItemKey(target);
  const held = (list: MusicList) => list.items.find((i) => i.item_key === itemKey);

  return (
    <div
      role="dialog"
      aria-label={`Add ${label} to a list`}
      className="w-72 max-w-full rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      // Escape closes the picker only, not the album modal behind it.
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">Add “{label}” to…</p>
        <button type="button" onClick={onClose} aria-label="Close list picker" className="shrink-0 text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
      <SharedListPicker
        lists={lists}
        loaded={loaded}
        isOn={(l) => held(l) !== undefined}
        count={(l) => l.items.length}
        onToggle={(l, on) => (on ? music.addToList(l.id, target) : music.removeFromList(l.id, held(l)!.id))}
        onCreate={async (name) => music.addToList((await music.createList(name)).id, target)}
        onChanged={refresh}
        autoFocus
      />
    </div>
  );
}
