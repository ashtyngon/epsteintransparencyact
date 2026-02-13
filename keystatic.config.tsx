import { config, fields, collection } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },
  ui: {
    brand: {
      name: 'Epstein Files Admin',
    },
    navigation: {
      Content: ['articles', 'people'],
      Editorial: ['timeline', 'survivors'],
    },
  },

  collections: {
    // ─── Articles ────────────────────────────────────────────────────
    articles: collection({
      label: 'Articles',
      slugField: 'title',
      path: 'src/content/articles/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['publishedAt', 'source', 'status'],
      schema: {
        title: fields.slug({
          name: {
            label: 'Headline',
            validation: { isRequired: true },
          },
        }),
        publishedAt: fields.datetime({
          label: 'Published',
          validation: { isRequired: true },
        }),
        updatedAt: fields.datetime({
          label: 'Updated',
        }),
        source: fields.text({
          label: 'Source outlet',
          validation: { isRequired: true },
        }),
        sourceUrl: fields.url({
          label: 'Source URL',
          validation: { isRequired: true },
        }),
        summary: fields.text({
          label: 'Summary (for cards and SEO)',
          multiline: true,
          validation: { isRequired: true },
        }),
        image: fields.image({
          label: 'Featured Image',
          directory: 'public/images/articles',
          publicPath: '/images/articles/',
          description: 'Upload a featured image for the article hero.',
        }),
        people: fields.array(
          fields.relationship({
            label: 'Person',
            collection: 'people',
          }),
          {
            label: 'People Mentioned',
            itemLabel: (props) => props.value ?? 'Select a person',
          }
        ),
        relatedArticles: fields.array(
          fields.text({ label: 'Article slug' }),
          {
            label: 'Related Articles',
            itemLabel: (props) => props.value ?? 'Enter article slug',
            description:
              'Full filename without .md extension (e.g., 2026-02-13-article-title)',
          }
        ),
        tags: fields.array(
          fields.text({ label: 'Tag' }),
          {
            label: 'Tags',
            itemLabel: (props) => props.value ?? 'Add a tag',
          }
        ),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Published', value: 'published' },
            { label: 'Draft', value: 'draft' },
            { label: 'In Review', value: 'review' },
            { label: 'Unpublished', value: 'unpublished' },
          ],
          defaultValue: 'published',
        }),
        aiGenerated: fields.checkbox({
          label: 'AI Generated',
          defaultValue: true,
          description: 'Uncheck if this article was written by a human editor.',
        }),
        articleType: fields.select({
          label: 'Article Type',
          options: [
            { label: 'News', value: 'news' },
            { label: 'Feature', value: 'feature' },
            { label: 'Analysis', value: 'analysis' },
          ],
          defaultValue: 'news',
        }),
        reviewedBy: fields.text({
          label: 'Reviewed By',
        }),
        reviewedAt: fields.datetime({
          label: 'Reviewed At',
        }),
        confidence: fields.number({
          label: 'Confidence Score (0-1)',
          validation: { min: 0, max: 1 },
        }),
        content: fields.markdoc({
          label: 'Article Body',
          extension: 'md',
        }),
      },
    }),

    // ─── People ──────────────────────────────────────────────────────
    people: collection({
      label: 'People',
      slugField: 'name',
      path: 'src/content/people/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['category', 'role'],
      schema: {
        name: fields.slug({
          name: {
            label: 'Full Name',
            validation: { isRequired: true },
          },
        }),
        aliases: fields.array(
          fields.text({ label: 'Alias' }),
          {
            label: 'Aliases / Other Names',
            itemLabel: (props) => props.value ?? 'Add an alias',
          }
        ),
        role: fields.text({
          label: 'Role / Title',
          validation: { isRequired: true },
        }),
        category: fields.select({
          label: 'Category',
          options: [
            { label: 'Named in Documents', value: 'named-in-documents' },
            { label: 'Witness', value: 'witness' },
            { label: 'Associate', value: 'associate' },
            { label: 'Official', value: 'official' },
            { label: 'Legal', value: 'legal' },
            { label: 'Victim / Survivor', value: 'victim-survivor' },
            { label: 'Other', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        shortBio: fields.text({
          label: 'Short Bio (for cards)',
          multiline: true,
          validation: { isRequired: true },
        }),
        notableConnections: fields.array(
          fields.relationship({
            label: 'Connection',
            collection: 'people',
          }),
          {
            label: 'Notable Connections',
            itemLabel: (props) => props.value ?? 'Select a person',
          }
        ),
        firstMentionedDate: fields.date({
          label: 'First Mentioned Date',
        }),
        image: fields.image({
          label: 'Photo',
          directory: 'public/images/people',
          publicPath: '/images/people/',
          description: 'Upload a headshot or photo of this person.',
        }),
        sources: fields.array(
          fields.object({
            title: fields.text({
              label: 'Source Title',
              validation: { isRequired: true },
            }),
            url: fields.url({
              label: 'Source URL',
              validation: { isRequired: true },
            }),
          }),
          {
            label: 'Sources',
            itemLabel: (props) => props.fields.title.value || 'New source',
          }
        ),
        sensitive: fields.checkbox({
          label: 'Sensitive Content',
          defaultValue: false,
          description: 'Flag if this entry contains sensitive or graphic details.',
        }),
        content: fields.markdoc({
          label: 'Biography',
          extension: 'md',
        }),
      },
    }),

    // ─── Timeline ────────────────────────────────────────────────────
    timeline: collection({
      label: 'Timeline Events',
      slugField: 'title',
      path: 'src/content/timeline/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['date', 'category'],
      schema: {
        title: fields.slug({
          name: {
            label: 'Event Title',
            validation: { isRequired: true },
          },
        }),
        date: fields.date({
          label: 'Date',
          validation: { isRequired: true },
        }),
        endDate: fields.date({
          label: 'End Date (for ranges)',
        }),
        category: fields.select({
          label: 'Category',
          options: [
            { label: 'Biography', value: 'biography' },
            { label: 'Legal', value: 'legal' },
            { label: 'Document Release', value: 'document-release' },
            { label: 'Legislation', value: 'legislation' },
            { label: 'Investigation', value: 'investigation' },
            { label: 'Media', value: 'media' },
            { label: 'Other', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        summary: fields.text({
          label: 'Summary',
          multiline: true,
          validation: { isRequired: true },
        }),
        people: fields.array(
          fields.relationship({
            label: 'Person',
            collection: 'people',
          }),
          {
            label: 'Related People',
            itemLabel: (props) => props.value ?? 'Select a person',
          }
        ),
        relatedArticles: fields.array(
          fields.text({ label: 'Article slug' }),
          {
            label: 'Related Articles',
            itemLabel: (props) => props.value ?? 'Enter article slug',
          }
        ),
        sources: fields.array(
          fields.object({
            title: fields.text({
              label: 'Source Title',
              validation: { isRequired: true },
            }),
            url: fields.url({
              label: 'Source URL',
              validation: { isRequired: true },
            }),
          }),
          {
            label: 'Sources',
            itemLabel: (props) => props.fields.title.value || 'New source',
          }
        ),
        order: fields.integer({
          label: 'Display Order',
          validation: { isRequired: true },
          description: 'Lower numbers appear first in the timeline.',
        }),
        content: fields.markdoc({
          label: 'Details',
          extension: 'md',
        }),
      },
    }),

    // ─── Survivors ───────────────────────────────────────────────────
    survivors: collection({
      label: 'Survivors',
      slugField: 'title',
      path: 'src/content/survivors/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['type', 'publishedAt'],
      schema: {
        title: fields.slug({
          name: {
            label: 'Title',
            validation: { isRequired: true },
          },
        }),
        publishedAt: fields.datetime({
          label: 'Published',
          validation: { isRequired: true },
        }),
        type: fields.select({
          label: 'Type',
          options: [
            { label: 'Statement', value: 'statement' },
            { label: 'Coverage', value: 'coverage' },
            { label: 'Profile', value: 'profile' },
            { label: 'Resource', value: 'resource' },
          ],
          defaultValue: 'coverage',
        }),
        source: fields.text({
          label: 'Source',
        }),
        sourceUrl: fields.url({
          label: 'Source URL',
        }),
        contentWarning: fields.text({
          label: 'Content Warning',
          description: 'Displayed before the content if set.',
        }),
        anonymous: fields.checkbox({
          label: 'Anonymous',
          defaultValue: false,
        }),
        people: fields.array(
          fields.relationship({
            label: 'Person',
            collection: 'people',
          }),
          {
            label: 'Related People',
            itemLabel: (props) => props.value ?? 'Select a person',
          }
        ),
        tags: fields.array(
          fields.text({ label: 'Tag' }),
          {
            label: 'Tags',
            itemLabel: (props) => props.value ?? 'Add a tag',
          }
        ),
        content: fields.markdoc({
          label: 'Content',
          extension: 'md',
        }),
      },
    }),
  },
});
