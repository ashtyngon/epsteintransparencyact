import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    source: z.string(),
    sourceUrl: z.string().url(),
    summary: z.string(),
    people: z.array(z.string()).default([]),
    relatedArticles: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    status: z.enum(['published', 'draft', 'review', 'unpublished']).default('published'),
    aiGenerated: z.boolean().default(true),
    articleType: z.enum(['news', 'feature', 'analysis']).default('news'),
    reviewedBy: z.string().optional(),
    reviewedAt: z.coerce.date().optional(),
    confidence: z.number().min(0).max(1).optional(),
    image: z.string().optional(),
    keyTakeaways: z.array(z.string()).default([]),
  }),
});

const people = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/people' }),
  schema: z.object({
    name: z.string(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    role: z.string(),
    category: z.enum([
      'named-in-documents',
      'witness',
      'associate',
      'official',
      'legal',
      'victim-survivor',
      'other',
    ]),
    shortBio: z.string(),
    notableConnections: z.array(z.string()).default([]),
    firstMentionedDate: z.coerce.date().optional(),
    image: z.string().optional(),
    sources: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().url(),
        })
      )
      .default([]),
    sensitive: z.boolean().default(false),
  }),
});

const timeline = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/timeline' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    era: z
      .enum([
        'origins',
        'first-prosecution',
        'exposure',
        'reckoning',
        'aftermath',
        'transparency',
      ])
      .default('origins'),
    category: z.enum([
      'biography',
      'legal',
      'document-release',
      'legislation',
      'investigation',
      'media',
      'civil-litigation',
      'network',
      'other',
    ]),
    summary: z.string(),
    image: z.string().optional(),
    imageCaption: z.string().optional(),
    significance: z.enum(['major', 'standard', 'minor']).default('standard'),
    people: z.array(z.string()).default([]),
    relatedArticles: z.array(z.string()).default([]),
    relatedEvents: z.array(z.string()).default([]),
    sources: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().url(),
        })
      )
      .default([]),
    order: z.number(),
  }),
});

const survivors = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/survivors' }),
  schema: z.object({
    title: z.string(),
    publishedAt: z.coerce.date(),
    type: z.enum(['statement', 'coverage', 'profile', 'resource']),
    source: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    contentWarning: z.string().optional(),
    anonymous: z.boolean().default(false),
    image: z.string().optional(),
    imageCaption: z.string().optional(),
    people: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { articles, people, timeline, survivors };
