import { createElement, forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  AlarmClock,
  Apple,
  Archive,
  ArrowUpDown,
  BadgeCheck,
  Bandage,
  Banknote,
  Bath,
  BedSingle,
  Bell,
  BellRing,
  Bike,
  Bird,
  BookOpen,
  Bookmark,
  Bot,
  Brain,
  Briefcase,
  Building2,
  Bus,
  Camera,
  Car,
  Cat,
  ChefHat,
  Circle,
  Clapperboard,
  ClipboardCheck,
  Cloud,
  CloudSun,
  Code2,
  Coffee,
  Compass,
  Cpu,
  Dice1,
  Disc3,
  Dog,
  Droplets,
  Dumbbell,
  Earth,
  Eye,
  Factory,
  Flag,
  Film,
  Flame,
  Flower2,
  Footprints,
  Frown,
  Gamepad2,
  Gift,
  Globe,
  HandHeart,
  Heart,
  HeartCrack,
  Hourglass,
  Laugh,
  Leaf,
  Lightbulb,
  MessageCircle,
  MessagesSquare,
  Mic,
  Minus,
  Moon,
  Mountain,
  Music,
  Paintbrush,
  PartyPopper,
  Pencil,
  Pill,
  Rainbow,
  Star,
  Sun,
  Target,
  Telescope,
  ThumbsUp,
  Trees,
  TriangleAlert,
  User,
  Users,
  Video,
  Waves,
  Wrench,
  Zap,
} from 'lucide-react';

type IconDefinition = {
  id: string;
  label: string;
  component: LucideIcon;
};

const HeartFillIcon = forwardRef<SVGSVGElement, LucideProps>((props, ref) =>
  createElement(Heart, { ...props, ref, fill: 'currentColor' })
);

HeartFillIcon.displayName = 'HeartFillIcon';

// Stable activity icon ids stored in the DB and resolved to Lucide components in the client.
const ICON_DEFINITIONS: IconDefinition[] = [
  { id: 'circle-fill', label: 'Circle', component: Circle },
  { id: 'person-fill', label: 'Person', component: User },
  { id: 'people-fill', label: 'People', component: Users },
  { id: 'heart', label: 'Heart', component: Heart },
  { id: 'heart-fill', label: 'Heart Filled', component: HeartFillIcon },
  { id: 'heart-break', label: 'Heartbreak', component: HeartCrack },
  { id: 'chat-bubble', label: 'Chat Bubble', component: MessageCircle },
  { id: 'chat-dots', label: 'Chat Dots', component: MessagesSquare },
  { id: 'telescope', label: 'Telescope', component: Telescope },
  { id: 'joystick', label: 'Joystick', component: Gamepad2 },
  { id: 'dice-1', label: 'Dice', component: Dice1 },
  { id: 'film', label: 'Film', component: Film },
  { id: 'book', label: 'Book', component: BookOpen },
  { id: 'music-note', label: 'Music', component: Music },
  { id: 'camera', label: 'Camera', component: Camera },
  { id: 'camera-video', label: 'Video', component: Video },
  { id: 'mountain', label: 'Mountain', component: Mountain },
  { id: 'bicycle', label: 'Bicycle', component: Bike },
  { id: 'person-walking', label: 'Walking', component: Footprints },
  { id: 'water', label: 'Water', component: Droplets },
  { id: 'water-waves', label: 'Waves', component: Waves },
  { id: 'disco', label: 'Disco', component: Disc3 },
  { id: 'tree', label: 'Tree', component: Trees },
  { id: 'sun-glasses', label: 'Sun', component: Sun },
  { id: 'fire', label: 'Fire', component: Flame },
  { id: 'briefcase', label: 'Briefcase', component: Briefcase },
  { id: 'code', label: 'Code', component: Code2 },
  { id: 'lightbulb', label: 'Lightbulb', component: Lightbulb },
  { id: 'pencil', label: 'Pencil', component: Pencil },
  { id: 'person-heart', label: 'Therapy', component: HandHeart },
  { id: 'dumbbell', label: 'Dumbbell', component: Dumbbell },
  { id: 'pill', label: 'Pill', component: Pill },
  { id: 'cup', label: 'Cup', component: Coffee },
  { id: 'leaf', label: 'Leaf', component: Leaf },
  { id: 'face-tired', label: 'Tired', component: Frown },
  { id: 'star', label: 'Star', component: Star },
  { id: 'star-fill', label: 'Star Filled', component: Star },
  { id: 'mic', label: 'Microphone', component: Mic },
  { id: 'hourglass-split', label: 'Hourglass', component: Hourglass },
  { id: 'eye', label: 'Eye', component: Eye },
  { id: 'moon', label: 'Moon', component: Moon },
  { id: 'arrow-down-up', label: 'Arrows', component: ArrowUpDown },
  { id: 'exclamation-triangle', label: 'Warning', component: TriangleAlert },
  { id: 'lightning-fill', label: 'Lightning', component: Zap },
  { id: 'target', label: 'Target', component: Target },
  { id: 'cloud-sun', label: 'Cloud Sun', component: CloudSun },
  { id: 'dash', label: 'Dash', component: Minus },
  { id: 'hand-thumbs-up', label: 'Thumbs Up', component: ThumbsUp },
  { id: 'screwdriver', label: 'Tool', component: Wrench },
  { id: 'emoji-laughing', label: 'Laugh', component: Laugh },
  { id: 'confetti', label: 'Confetti', component: PartyPopper },
  { id: 'broom', label: 'Cleaning', component: Paintbrush },
  { id: 'cloud', label: 'Cloud', component: Cloud },
  { id: 'sun', label: 'Sun', component: Sun },
  { id: 'rainbow', label: 'Rainbow', component: Rainbow },
  { id: 'alarm-clock', label: 'Alarm Clock', component: AlarmClock },
  { id: 'apple', label: 'Apple', component: Apple },
  { id: 'archive', label: 'Archive', component: Archive },
  { id: 'badge-check', label: 'Badge Check', component: BadgeCheck },
  { id: 'bandage', label: 'Bandage', component: Bandage },
  { id: 'banknote', label: 'Banknote', component: Banknote },
  { id: 'bath', label: 'Bath', component: Bath },
  { id: 'bed-single', label: 'Bed', component: BedSingle },
  { id: 'bell', label: 'Bell', component: Bell },
  { id: 'bell-ring', label: 'Bell Ring', component: BellRing },
  { id: 'bird', label: 'Bird', component: Bird },
  { id: 'bookmark', label: 'Bookmark', component: Bookmark },
  { id: 'bot', label: 'Bot', component: Bot },
  { id: 'brain', label: 'Brain', component: Brain },
  { id: 'building', label: 'Building', component: Building2 },
  { id: 'bus', label: 'Bus', component: Bus },
  { id: 'car', label: 'Car', component: Car },
  { id: 'cat', label: 'Cat', component: Cat },
  { id: 'chef-hat', label: 'Chef Hat', component: ChefHat },
  { id: 'clapperboard', label: 'Clapperboard', component: Clapperboard },
  { id: 'clipboard-check', label: 'Clipboard Check', component: ClipboardCheck },
  { id: 'compass', label: 'Compass', component: Compass },
  { id: 'cpu', label: 'CPU', component: Cpu },
  { id: 'dog', label: 'Dog', component: Dog },
  { id: 'earth', label: 'Earth', component: Earth },
  { id: 'factory', label: 'Factory', component: Factory },
  { id: 'flag', label: 'Flag', component: Flag },
  { id: 'flower', label: 'Flower', component: Flower2 },
  { id: 'gift', label: 'Gift', component: Gift },
  { id: 'globe', label: 'Globe', component: Globe },
];

const ICON_COMPONENTS = Object.fromEntries(
  ICON_DEFINITIONS.map(({ id, component }) => [id, component])
) as Record<string, LucideIcon>;

const ICON_ALIASES: Record<string, string> = {
  person: 'person-fill',
  people: 'people-fill',
  messages: 'chat-dots',
  message: 'chat-bubble',
};

export const ICON_LIBRARY = ICON_DEFINITIONS.map(({ id }) => id);

export const ICON_NAMES: Record<string, string> = Object.fromEntries(
  ICON_DEFINITIONS.map(({ id, label }) => [id, label])
);

export function resolveActivityIcon(iconName?: string | null): LucideIcon | null {
  if (!iconName) return null;

  const normalized = iconName.trim().toLowerCase();
  if (ICON_COMPONENTS[normalized]) {
    return ICON_COMPONENTS[normalized];
  }

  const alias = ICON_ALIASES[normalized];
  if (alias && ICON_COMPONENTS[alias]) {
    return ICON_COMPONENTS[alias];
  }

  return null;
}
