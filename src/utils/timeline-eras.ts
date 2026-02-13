export interface Era {
  id: string;
  label: string;
  shortLabel: string;
  dateRange: string;
  description: string;
  color: string; // hex value
}

export const ERAS: Era[] = [
  {
    id: 'origins',
    label: 'Origins & Network Building',
    shortLabel: 'Origins',
    dateRange: '1976–2004',
    description:
      'Epstein builds his financial empire and cultivates a network of powerful connections across politics, finance, and academia.',
    color: '#475569',
  },
  {
    id: 'first-prosecution',
    label: 'First Prosecution',
    shortLabel: 'Prosecution',
    dateRange: '2005–2011',
    description:
      'Palm Beach investigation leads to a controversial plea deal that shields Epstein from federal charges.',
    color: '#b45309',
  },
  {
    id: 'exposure',
    label: 'Public Exposure',
    shortLabel: 'Exposure',
    dateRange: '2014–2018',
    description:
      'Civil suits and investigative journalism break the story wide open, forcing public reckoning.',
    color: '#c2410c',
  },
  {
    id: 'reckoning',
    label: 'Arrest & Death',
    shortLabel: 'Reckoning',
    dateRange: '2019',
    description:
      'Federal arrest on trafficking charges ends with Epstein found dead in his jail cell.',
    color: '#dc2626',
  },
  {
    id: 'aftermath',
    label: 'Aftermath & Accountability',
    shortLabel: 'Aftermath',
    dateRange: '2020–2024',
    description:
      'Maxwell trial, civil litigation, and document releases begin to reveal the full scope of the network.',
    color: '#7c3aed',
  },
  {
    id: 'transparency',
    label: 'The Transparency Era',
    shortLabel: 'Transparency',
    dateRange: '2025–Present',
    description:
      'Landmark legislation mandates federal document releases and public accountability.',
    color: '#059669',
  },
];

export function getEra(id: string): Era {
  return ERAS.find((e) => e.id === id) ?? ERAS[0];
}

export function getEraCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    biography: 'Biography',
    legal: 'Legal',
    'document-release': 'Documents',
    legislation: 'Legislation',
    investigation: 'Investigation',
    media: 'Media',
    'civil-litigation': 'Civil Litigation',
    network: 'Network',
    other: 'Political',
  };
  return labels[category] ?? 'Other';
}
