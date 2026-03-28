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
    <div className="min-h-screen bg-gray-50 pb-16 md:pb-0 flex flex-col">
      {/* Top nav */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-primary-600">
            WhereWeWere
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive(pathname, to)
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
        <footer className="bg-white border-t border-gray-200 mt-8">
          <div className="max-w-5xl mx-auto px-4 py-10">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
              <div>
                <Link to="/" className="text-lg font-bold text-primary-600 flex items-center gap-2">
                  <MapPin size={20} />
                  WhereWeWere
                </Link>
                <p className="text-sm text-gray-500 mt-2 max-w-xs">
                  A self-hosted check-in tracker for the places that matter to you.
                </p>
              </div>
              <div className="flex gap-12">
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Navigate</h4>
                  <ul className="space-y-2">
                    <li>
                      <Link to="/" className="text-sm text-gray-600 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <Home size={14} />
                        Home
                      </Link>
                    </li>
                    <li>
                      <Link to="/profile" className="text-sm text-gray-600 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <User size={14} />
                        Profile
                      </Link>
                    </li>
                    <li>
                      <Link to="/settings" className="text-sm text-gray-600 hover:text-primary-600 transition-colors flex items-center gap-1.5">
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
                      <Link to="/docs" className="text-sm text-gray-600 hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        <BookOpen size={14} />
                        Documentation
                      </Link>
                    </li>
                    <li>
                      <Link to="/docs/getting-started" className="text-sm text-gray-600 hover:text-primary-600 transition-colors">
                        Getting Started
                      </Link>
                    </li>
                    <li>
                      <Link to="/docs/api/checkins" className="text-sm text-gray-600 hover:text-primary-600 transition-colors">
                        API Reference
                      </Link>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 mt-8 pt-6 text-center">
              <p className="text-xs text-gray-400">WhereWeWere — your places, your data, your server.</p>
            </div>
          </div>
        </footer>
      )}

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-50">
        <div className="flex justify-around">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center py-2 px-3 text-xs ${
                isActive(pathname, to) ? 'text-primary-600' : 'text-gray-500'
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
