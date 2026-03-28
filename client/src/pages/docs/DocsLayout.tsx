import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Rocket, Server, Database, Map } from 'lucide-react';

const sections = [
  { to: '/docs', label: 'Overview', icon: BookOpen, exact: true },
  { to: '/docs/getting-started', label: 'Getting Started', icon: Rocket },
  { to: '/docs/api/checkins', label: 'Check-ins API', icon: Map },
  { to: '/docs/api/venues', label: 'Venues API', icon: Map },
  { to: '/docs/api/stats', label: 'Stats API', icon: Database },
  { to: '/docs/api/search', label: 'Search API', icon: Server },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="flex gap-8">
      {/* Sidebar */}
      <aside className="hidden md:block w-56 shrink-0">
        <nav className="sticky top-20 space-y-1">
          <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Documentation
          </p>
          {sections.map(({ to, label, icon: Icon, exact }) => {
            const active = exact ? pathname === to : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile nav */}
      <div className="md:hidden mb-6 w-full">
        <select
          value={pathname}
          onChange={(e) => window.location.href = e.target.value}
          className="input"
        >
          {sections.map(({ to, label }) => (
            <option key={to} value={to}>{label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <article className="min-w-0 flex-1 prose prose-gray prose-sm max-w-none
        prose-headings:scroll-mt-20
        prose-h1:text-2xl prose-h1:font-bold prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-3
        prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-10
        prose-h3:text-lg prose-h3:font-semibold
        prose-code:before:content-none prose-code:after:content-none
        prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono
        prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-xl prose-pre:shadow-sm
        prose-table:text-sm
        prose-th:bg-gray-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:border-b-2
        prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-gray-100
      ">
        {children}
      </article>
    </div>
  );
}
