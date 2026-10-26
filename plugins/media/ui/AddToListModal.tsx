import { X } from 'lucide-react';
import { ListPicker } from '../../../client/src/components/lists/ListPicker';
import { useLists } from '../../../client/src/components/lists/useLists';
import { media } from './api';
import type { MediaList } from './types';

interface AddToListModalProps {
  /** The media item (a whole show for TV) to add to / remove from lists. */
  itemId: string;
  onClose: () => void;
}

export default function AddToListModal({ itemId, onClose }: AddToListModalProps) {
  const { lists, loading, refresh } = useLists<MediaList>(media.lists);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add to List</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <ListPicker
          lists={lists}
          loaded={!loading}
          isOn={(l) => l.items.some((i) => i.id === itemId)}
          count={(l) => l.items.length}
          onToggle={(l, on) => (on ? media.addItemToList(l.id, itemId) : media.removeItemFromList(l.id, itemId))}
          onCreate={async (name) => media.addItemToList((await media.createList(name)).id, itemId)}
          onChanged={refresh}
          autoFocus
          emptyText="No lists yet — create one below."
        />
      </div>
    </div>
  );
}
