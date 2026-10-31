import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, User, Settings, CircleUser, LogOut, ChevronDown } from 'lucide-react';
import { accountLabel, useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}

/** Signed-in user's name with a menu holding Account settings and Sign out. */
function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();

  // Close on navigation and on clicks outside the menu.
  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const name = accountLabel(user);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 max-w-[12rem] px-2.5 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200 transition-all"
      >
        <CircleUser size={18} className="shrink-0" />
        <span className="truncate">{name}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-xl border border-white/40 dark:border-gray-700/60 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-lg shadow-black/10 py-1 z-70"
        >
          <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
            Signed in as <span className="font-medium text-gray-700 dark:text-gray-200">{user.username}</span>
          </div>
          <Link
            role="menuitem"
            to="/settings?tab=account"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/70 dark:hover:bg-gray-800/70"
          >
            <Settings size={15} />
            Account settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/70 dark:hover:bg-gray-800/70"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="app-shell min-h-screen pb-16 md:pb-0 flex flex-col">
      {/* Top nav — glass header */}
      <header className="sticky top-0 z-60 bg-white/70 dark:bg-gray-900/70 border-b backdrop-blur-sm border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-display text-2xl tracking-wide text-[#ea580c]">
            WhereWeWere
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-auto mr-1">
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
          <UserMenu />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-2 md:px-4 py-6 flex-1 w-full">
        <div key={pathname} className="page-enter">
          {children}
        </div>
      </main>

      {/* Bottom nav (mobile) — glass */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/70 dark:bg-gray-900/70 border-t border-white/40 dark:border-gray-700/40 z-60">
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
