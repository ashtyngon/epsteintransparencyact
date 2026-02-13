export interface Era {
  id: string;
  label: string;
  shortLabel: string;
  dateRange: string;
  description: string;
  color: string;
  accentColor: string;
  borderColor: string;
}

export const ERAS: Era[] = [
  {
    id: 'origins',
    label: 'Origins & Network Building',
    shortLabel: 'Origins',
    dateRange: '1976 - 2004',
    description:
      'Epstein builds his financial empire and cultivates a network of powerful connections across politics, finance, and academia.',
    color: 'bg-slate-700',
    accentColor: 'text-slate-400',
    borderColor: 'border-slate-500',
  },
  {
    id: 'first-prosecution',
    label: 'First Prosecution',
    shortLabel: 'Prosecution',
    dateRange: '2005 - 2011',
    description:
      'Palm Beach investigation leads to a controversial plea deal that shields Epstein from federal charges.',
    color: 'bg-amber-700',
    accentColor: 'text-amber-400',
    borderColor: 'border-amber-500',
  },
  {
    id: 'exposure',
    label: 'Public Exposure',
    shortLabel: 'Exposure',
    dateRange: '2014 - 2018',
    description:
      'Civil suits and investigative journalism break the story wide open, forcing public reckoning.',
    color: 'bg-orange-700',
    accentColor: 'text-orange-400',
    borderColor: 'border-orange-500',
  },
  {
    id: 'reckoning',
    label: 'Arrest & Death',
    shortLabel: 'Reckoning',
    dateRange: '2019',
    description:
      'Federal arrest on trafficking charges ends with Epstein found dead in his jail cell.',
    color: 'bg-red-800',
    accentColor: 'text-red-400',
    borderColor: 'border-red-500',
  },
  {
    id: 'aftermath',
    label: 'Aftermath & Accountability',
    shortLabel: 'Aftermath',
    dateRange: '2020 - 2024',
    description:
      'Maxwell trial, civil litigation, and document releases begin to reveal the full scope of the network.',
    color: 'bg-purple-800',
    accentColor: 'text-purple-400',
    borderColor: 'border-purple-500',
  },
  {
    id: 'transparency',
    label: 'The Transparency Era',
    shortLabel: 'Transparency',
    dateRange: '2025 - Present',
    description:
      'Landmark legislation mandates federal document releases and public accountability.',
    color: 'bg-emerald-800',
    accentColor: 'text-emerald-400',
    borderColor: 'border-emerald-500',
  },
];

export function getEra(id: string): Era {
  return ERAS.find((e) => e.id === id) ?? ERAS[0];
}

export function getEraCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    biography: 'bg-blue-100 text-blue-800',
    legal: 'bg-red-100 text-red-800',
    'document-release': 'bg-amber-100 text-amber-800',
    legislation: 'bg-emerald-100 text-emerald-800',
    investigation: 'bg-orange-100 text-orange-800',
    media: 'bg-purple-100 text-purple-800',
    'civil-litigation': 'bg-pink-100 text-pink-800',
    network: 'bg-indigo-100 text-indigo-800',
    other: 'bg-gray-100 text-gray-800',
  };
  return colors[category] ?? colors.other;
}
