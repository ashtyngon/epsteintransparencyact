export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Epstein Transparency Project',
    url: 'https://epsteintransparencyact.com',
    description:
      'A factual database tracking developments around the Epstein Files and the Epstein Transparency Act.',
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
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt.toISOString(),
    dateModified: (article.updatedAt ?? article.publishedAt).toISOString(),
    author: {
      '@type': 'Organization',
      name: 'Epstein Transparency Project',
      url: 'https://epsteintransparencyact.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Epstein Transparency Project',
      url: 'https://epsteintransparencyact.com',
    },
    mainEntityOfPage: `https://epsteintransparencyact.com/articles/${article.slug}`,
    isBasedOn: {
      '@type': 'NewsArticle',
      url: article.sourceUrl,
      publisher: { '@type': 'Organization', name: article.source },
    },
    ...(article.image ? { image: article.image } : {}),
  };
}

export function personJsonLd(person: {
  name: string;
  shortBio: string;
  slug: string;
  image?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: person.name,
    description: person.shortBio,
    url: `https://epsteintransparencyact.com/people/${person.slug}`,
    ...(person.image ? { image: person.image } : {}),
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

export function timelineJsonLd(
  entries: { title: string; date: Date; summary: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'The Epstein Case — Complete Timeline',
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
