import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { ICON_LIBRARY, ICON_NAMES, resolveActivityIcon } from '../utils/icons';

interface IconPickerProps {
  value?: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}

export default function IconPicker({ value, onChange, onClose }: IconPickerProps) {
  const [search, setSearch] = useState('');

  const filteredIcons = useMemo(() => {
    if (!search.trim()) return ICON_LIBRARY;
    const lowercaseSearch = search.toLowerCase();
    return ICON_LIBRARY.filter(
      (icon) =>
        icon.toLowerCase().includes(lowercaseSearch) ||
        ICON_NAMES[icon]?.toLowerCase().includes(lowercaseSearch)
    );
  }, [search]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Select Icon</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
          >
            <X size={20} className="text-gray-500 dark:text-gray-300" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-300" />
            <input
              type="text"
              placeholder="Search icons..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              autoFocus
            />
          </div>
        </div>

        {/* Icon Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-5 gap-3">
            {filteredIcons.length > 0 ? (
              filteredIcons.map((icon) => {
                const IconComponent = resolveActivityIcon(icon);
                return (
                  <button
                    key={icon}
                    onClick={() => onChange(icon)}
                    title={ICON_NAMES[icon] || icon}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg transition ${
                      value === icon
                        ? 'bg-blue-100 dark:bg-blue-900/40 border-2 border-blue-500 text-blue-900 dark:text-blue-100'
                        : 'bg-gray-100 dark:bg-gray-800 border-2 border-transparent text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {IconComponent && <IconComponent size={24} className="text-current" />}
                    <div className="text-xs mt-1 text-center truncate w-full text-current">
                      {ICON_NAMES[icon] || icon}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="col-span-5 text-center py-8 text-gray-500 dark:text-gray-300">
                No icons found
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => onChange(null)}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
