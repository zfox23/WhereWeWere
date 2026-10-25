export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatClock(iso: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(iso));
  }
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export function joinArtists(artists: string[] | undefined | null): string {
  return (artists ?? []).join(', ');
}
