/**
 * Single source of truth for person-category metadata: labels (full / short /
 * plural), Tailwind badge classes, and raw hex (for SVG/canvas graph rendering).
 * Colors are unchanged from the original design — this only de-duplicates the
 * maps that were previously copied across PersonCard, PersonLayout and the
 * names directory.
 */

export type PersonCategory =
  | 'named-in-documents'
  | 'witness'
  | 'associate'
  | 'official'
  | 'legal'
  | 'victim-survivor'
  | 'other';

export const CATEGORY_ORDER: PersonCategory[] = [
  'named-in-documents',
  'witness',
  'associate',
  'official',
  'legal',
  'victim-survivor',
  'other',
];

/** Full singular labels — directory list view, profile header. */
export const categoryLabel: Record<string, string> = {
  'named-in-documents': 'Named in Documents',
  witness: 'Witness',
  associate: 'Associate',
  official: 'Official',
  legal: 'Legal',
  'victim-survivor': 'Victim / Survivor',
  other: 'Other',
};

/** Short labels — compact card badges. */
export const categoryLabelShort: Record<string, string> = {
  'named-in-documents': 'Named',
  witness: 'Witness',
  associate: 'Associate',
  official: 'Official',
  legal: 'Legal',
  'victim-survivor': 'Survivor',
  other: 'Other',
};

/** Plural labels — directory "Profiles" section headers. */
export const categoryLabelPlural: Record<string, string> = {
  'named-in-documents': 'Named in Documents',
  witness: 'Witnesses',
  associate: 'Associates',
  official: 'Officials',
  legal: 'Legal',
  'victim-survivor': 'Victims & Survivors',
  other: 'Other',
};

/** Tailwind badge classes — UNCHANGED from the original design. */
export const categoryColorClass: Record<string, string> = {
  'named-in-documents': 'bg-highlight text-white',
  witness: 'bg-amber-600 text-white',
  associate: 'bg-red-700 text-white',
  official: 'bg-blue-700 text-white',
  legal: 'bg-purple-700 text-white',
  'victim-survivor': 'bg-emerald-700 text-white',
  other: 'bg-gray-600 text-white',
};

/** Hex equivalents of the Tailwind classes above — for the graph renderer. */
export const categoryColorHex: Record<string, string> = {
  'named-in-documents': '#dc2626', // highlight
  witness: '#d97706', // amber-600
  associate: '#b91c1c', // red-700
  official: '#1d4ed8', // blue-700
  legal: '#7e22ce', // purple-700
  'victim-survivor': '#047857', // emerald-700
  other: '#4b5563', // gray-600
};

export function catColorClass(category: string): string {
  return categoryColorClass[category] || categoryColorClass.other;
}

export function catColorHex(category: string): string {
  return categoryColorHex[category] || categoryColorHex.other;
}

export function catLabel(category: string): string {
  return categoryLabel[category] || category;
}
