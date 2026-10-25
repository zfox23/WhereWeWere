import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { media } from './api';
import type { MediaList } from './types';

interface AddToListModalProps {
  /** The media item (a whole show for TV) to add to / remove from lists. */
  itemId: string;
  onClose: () => void;
}

export default function AddToListModal({ itemId, onClose }: AddToListModalProps) {
  const [lists, setLists] = useState<MediaList[]>([]);
  const [newListName, setNewListName] = useState('');
  const [listMsg, setListMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    media
      .lists()
      .then((data) => { if (!cancelled) setLists(data); })
      .catch(() => { if (!cancelled) setLists([]); });
    return () => { cancelled = true; };
  }, []);

  const handleAddToList = async (listId: string) => {
    try {
      await media.addItemToList(listId, itemId);
      setLists(await media.lists());
      setListMsg('Added to list.');
    } catch (err) {
      setListMsg(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newListName.trim()) return;
    try {
      const list = await media.createList(newListName.trim());
      await media.addItemToList(list.id, itemId);
      setLists(await media.lists());
      setNewListName('');
      setListMsg('Created and added to list.');
    } catch (err) {
      setListMsg(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRemoveFromList = async (listId: string) => {
    try {
      await media.removeItemFromList(listId, itemId);
      setLists(await media.lists());
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add to List</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {lists.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No lists yet — create one below.</p>
          )}
          {lists.map((list) => {
            const inList = list.items.some((i) => i.id === itemId);
            return (
              <div key={list.id} className="flex items-center justify-between gap-2">
                <button
                  onClick={() => handleAddToList(list.id)}
                  disabled={inList}
                  className={`flex-1 text-left px-3 py-2 rounded-lg text-sm border transition-colors ${inList
                    ? 'border-gray-100 dark:border-gray-800 text-gray-400 cursor-default'
                    : 'border-gray-200 dark:border-gray-700 hover:border-primary-400 text-gray-700 dark:text-gray-300'
                    }`}
                >
                  {list.name}
                  {inList && <span className="ml-2 text-xs text-green-600">✓ added</span>}
                </button>
                {inList && (
                  <button
                    onClick={() => handleRemoveFromList(list.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500"
                    title="Remove from list"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAdd(); }}
            placeholder="New list name…"
            className="input text-sm"
          />
          <button
            onClick={handleCreateAndAdd}
            disabled={!newListName.trim()}
            className="btn-primary text-sm whitespace-nowrap"
          >
            Create & Add
          </button>
        </div>

        {listMsg && <p className="text-xs text-gray-500">{listMsg}</p>}
      </div>
    </div>
  );
}
