import type { ReactNode } from 'react';

interface CardShellProps {
  children: ReactNode;
  compact?: boolean;
}

export function CardShell({ children, compact = false }: CardShellProps) {
  return (
    <div
      className={`group bg-white/60 dark:bg-gray-900/60 border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 hover:shadow-md transition-all ${
        compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4'
      }`}
    >
      {children}
    </div>
  );
}
