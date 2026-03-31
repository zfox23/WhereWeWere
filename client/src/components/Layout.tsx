import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, User, Settings, MapPin, BookOpen } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isHomePage = pathname === '/';

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 pb-16 md:pb-0 flex flex-col">
      {/* Top nav — glass header */}
      <header className="sticky top-0 z-50 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-b border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold bg-gradient-to-r from-primary-600 to-amber-500 bg-clip-text text-transparent">
            WhereWeWere
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive(pathname, to)
                    ? 'bg-primary-500/10 text-primary-700 dark:text-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-6 flex-1 w-full">{children}</main>

      {/* Footer — hidden on homepage */}
      {!isHomePage && (
        <footer className="bg-white/50 dark:bg-gray-900/50 backdrop-blur-md border-t border-white/40 dark:border-gray-700/40 mt-8">
          <div className="max-w-5xl mx-auto px-4 py-10">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
              <div>
                <Link to="/" className="text-lg font-bold bg-gradient-to-r from-primary-600 to-amber-500 bg-clip-text text-transparent flex items-center gap-2">
                  <MapPin size={20} className="text-primary-600" />
                  WhereWeWere
                </Link>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-xs">
                  A self-hosted check-in tracker for the places that matter to you.
                </p>
              </div>
              <div className="flex gap-12">
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Navigate</h4>
                  <ul className="space-y-2">
                    <li>
                      <Link to="/" className="text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <Home size={14} />
                        Home
                      </Link>
                    </li>
                    <li>
                      <Link to="/profile" className="text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <User size={14} />
                        Profile
                      </Link>
                    </li>
                    <li>
                      <Link to="/settings" className="text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <Settings size={14} />
                        Settings
                      </Link>
                    </li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Resources</h4>
                  <ul className="space-y-2">
                    <li>
                      <Link to="/docs" className="text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <BookOpen size={14} />
                        Documentation
                      </Link>
                    </li>
                    <li>
                      <Link to="/docs/getting-started" className="text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 transition-colors">
                        Getting Started
                      </Link>
                    </li>
                    <li>
                      <Link to="/docs/api/checkins" className="text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 transition-colors">
                        API Reference
                      </Link>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </footer>
      )}

      {/* Bottom nav (mobile) — glass */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-t border-white/40 dark:border-gray-700/40 z-50">
        <div className="flex justify-around">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center py-2 px-3 text-xs transition-colors ${
                isActive(pathname, to) ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon size={20} />
              <span className="mt-0.5">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
