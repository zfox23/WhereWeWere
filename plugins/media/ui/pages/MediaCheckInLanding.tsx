import { Link } from 'react-router-dom';
import { MEDIA_SUBTYPES, MEDIA_SUBTYPE_LIST } from '../../utils/media';

export default function MediaCheckInLanding() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎬</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Media Check-In</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MEDIA_SUBTYPE_LIST.map((subtype) => {
          const config = MEDIA_SUBTYPES[subtype];
          return (
            <Link
              key={subtype}
              to={config.searchPath}
              className="flex items-center gap-3 p-4 bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 hover:bg-white dark:hover:bg-gray-800/60 transition-colors"
            >
              <span className="text-3xl">{config.icon}</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{config.plural}</div>
                {config.apiName && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">via {config.apiName}</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
