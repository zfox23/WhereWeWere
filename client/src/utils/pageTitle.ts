import { useEffect } from 'react';

const APP_NAME = 'WhereWeWere';

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

export function formatPageTitle(title: string): string {
  const normalizedTitle = normalizeTitle(title);
  return normalizedTitle ? `${normalizedTitle} | ${APP_NAME}` : APP_NAME;
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = formatPageTitle(title);
  }, [title]);
}
