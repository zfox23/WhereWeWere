export function formatDate(dateStr: string, timeZone?: string | null): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}),
  };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatMalojaDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function buildImmichTimeUrl(immichUrl: string, checkedInAt: string): string {
  const t = new Date(checkedInAt);
  const takenAfter = new Date(t.getTime() - 20 * 60 * 1000).toISOString();
  const takenBefore = new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const query = JSON.stringify({ takenAfter, takenBefore });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

export function buildMalojaTrackUrl(malojaUrl: string, artists: string[], title?: string): string {
  const params = new URLSearchParams();
  for (const artist of artists) {
    params.append('trackartist', artist);
  }
  if (title) params.append('title', title);
  return `${malojaUrl}/track?${params.toString()}`;
}
