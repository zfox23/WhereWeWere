import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Content a card host (the Home timeline) wants shown at the bottom of every
 * card, whatever type it is — e.g. what was playing at the time. Cards render
 * it by using `CardShell`; they need no per-type code.
 */
export const CardFooterContext = createContext<ReactNode>(null);

interface CardShellProps {
  children: ReactNode;
  compact?: boolean;
}

export function CardShell({ children, compact = false }: CardShellProps) {
  const footer = useContext(CardFooterContext);
  return (
    <div
      className={`group bg-white/60 dark:bg-gray-900/60 border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 hover:shadow-md transition-all ${
        compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4'
      }`}
    >
      {children}
      {footer}
    </div>
  );
}
