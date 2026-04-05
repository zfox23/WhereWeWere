import { Frown, Annoyed, Meh, Smile, Laugh, CloudRain, Cloud, CloudSun, Sun, Rainbow } from 'lucide-react';

export const MOOD_LABELS = ['', 'Awful', 'Bad', 'Meh', 'Good', 'Excellent'];

export const MOOD_COLORS = [
  '',
  'text-red-500',
  'text-orange-500',
  'text-yellow-500',
  'text-lime-500',
  'text-green-500',
];

export const MOOD_BG_COLORS = [
  '',
  'bg-red-50 dark:bg-red-900/20',
  'bg-orange-50 dark:bg-orange-900/20',
  'bg-yellow-50 dark:bg-yellow-900/20',
  'bg-lime-50 dark:bg-lime-900/20',
  'bg-green-50 dark:bg-green-900/20',
];

const EMOJI_ICONS = ['', '😢', '😕', '😐', '🙂', '😄'];

const LUCIDE_ICONS = [null, Frown, Annoyed, Meh, Smile, Laugh];
const NATURE_ICONS = [null, CloudRain, Cloud, CloudSun, Sun, Rainbow];

export function MoodIcon({ mood, pack = 'emoji', size = 24 }: { mood: number; pack?: string; size?: number }) {
  if (mood < 1 || mood > 5) return null;

  if (pack === 'emoji') {
    return <span style={{ fontSize: size * 0.9, lineHeight: 1 }}>{EMOJI_ICONS[mood]}</span>;
  }

  const icons = pack === 'nature' ? NATURE_ICONS : LUCIDE_ICONS;
  const Icon = icons[mood];
  if (!Icon) return null;

  return <Icon size={size} className={MOOD_COLORS[mood]} />;
}

export function MoodIconRow({ pack = 'emoji', size = 24 }: { pack?: string; size?: number }) {
  return (
    <div className="flex flex-wrap justify-center items-center gap-2">
      {[1, 2, 3, 4, 5].map((m) => (
        <MoodIcon key={m} mood={m} pack={pack} size={size} />
      ))}
    </div>
  );
}
