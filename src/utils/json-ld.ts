export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Epstein Files Tracker',
    alternateName: ['Epstein Transparency Project', 'Epstein Transparency Act News'],
    url: 'https://epsteintransparencyact.com',
    description:
      'Track every name, document, and DOJ release from the Epstein Files. Searchable database of people named in documents, timeline of events, and daily sourced coverage.',
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://epsteintransparencyact.com/search?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  };
}

export function articleJsonLd(article: {
  title: string;
  summary: string;
  publishedAt: Date;
  updatedAt?: Date;
  slug: string;
  source: string;
  sourceUrl: string;
  image?: string;
  sources?: { title: string; url: string }[];
}) {
  const citations = article.sources?.map((s) => ({
    '@type': 'CreativeWork' as const,
    name: s.title,
    url: s.url,
  })) || [];

  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt.toISOString(),
    dateModified: (article.updatedAt ?? article.publishedAt).toISOString(),
    author: {
      '@type': 'Organization',
      name: 'Epstein Files Tracker',
      url: 'https://epsteintransparencyact.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Epstein Files Tracker',
      url: 'https://epsteintransparencyact.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://epsteintransparencyact.com/og-image.png',
        width: 1200,
        height: 630,
      },
    },
    mainEntityOfPage: `https://epsteintransparencyact.com/news/${article.slug}`,
    isBasedOn: {
      '@type': 'NewsArticle',
      url: article.sourceUrl,
      publisher: { '@type': 'Organization', name: article.source },
    },
    ...(citations.length > 0 ? { citation: citations } : {}),
    ...(article.image ? { image: article.image } : {}),
  };
}

export function personJsonLd(person: {
  name: string;
  shortBio: string;
  role: string;
  slug: string;
  image?: string;
  sources?: { title: string; url: string }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: person.name,
    description: person.shortBio,
    jobTitle: person.role,
    url: `https://epsteintransparencyact.com/people/${person.slug}`,
    ...(person.image ? { image: person.image } : {}),
    ...(person.sources?.length ? {
      subjectOf: person.sources.map((s) => ({
        '@type': 'NewsArticle',
        name: s.title,
        url: s.url,
      })),
    } : {}),
  };
}

export function breadcrumbJsonLd(
  items: { name: string; url: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function newsListJsonLd(
  articles: { title: string; slug: string; publishedAt: Date; summary: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Epstein Files News — Document Releases, Investigations & Updates',
    description: 'Daily coverage of the Epstein Files — DOJ document releases, names revealed, congressional hearings, and criminal investigations.',
    url: 'https://epsteintransparencyact.com/news/',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: articles.slice(0, 20).map((article, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `https://epsteintransparencyact.com/news/${article.slug}/`,
        name: article.title,
      })),
    },
  };
}

export function timelineJsonLd(
  entries: { title: string; date: Date; summary: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Epstein Case Timeline — 1994 to Present',
    itemListElement: entries.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: entry.title,
      description: entry.summary,
    })),
  };
}

export function timelineEventJsonLd(event: {
  title: string;
  date: Date;
  summary: string;
  slug: string;
  image?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.summary,
    startDate: event.date.toISOString(),
    url: `https://epsteintransparencyact.com/timeline/${event.slug}`,
    ...(event.image ? { image: event.image } : {}),
  };
}
