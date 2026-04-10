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
      <main className="max-w-5xl mx-auto px-2 md:px-4 py-6 flex-1 w-full">
        <div key={pathname} className="page-enter">
          {children}
        </div>
      </main>

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
