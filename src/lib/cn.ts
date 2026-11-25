import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Tailwind v4 prefixes behave like the first variant (rio:hover:…), including overrides.
const merge = extendTailwindMerge({ prefix: 'rio' });
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
