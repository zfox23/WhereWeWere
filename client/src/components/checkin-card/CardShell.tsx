import type { ReactNode } from 'react';

interface CardShellProps {
  children: ReactNode;
}

export function CardShell({ children }: CardShellProps) {
  return (
    <div className="group bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4 hover:shadow-md transition-all">
      {children}
    </div>
  );
}