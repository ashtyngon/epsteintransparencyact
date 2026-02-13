import { config, fields, collection, singleton } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },
  ui: {
    brand: {
      name: 'Epstein Files CMS',
    },
    navigation: {
      'News Desk': ['articles'],
      'People & Network': ['people'],
      'Timeline & History': ['timeline'],
      Survivors: ['survivors'],
      'Site Configuration': ['siteSettings'],
    },
  },

  singletons: {
    // ─── Site Settings ────────────────────────────────────────────────
    siteSettings: singleton({
      label: 'Site Settings',
      path: 'src/content/settings/site',
      format: 'json',
      schema: {
        siteName: fields.text({
          label: 'Site Name',
          validation: { isRequired: true },
        }),
        siteDescription: fields.text({
          label: 'Site Description',
          multiline: true,
          validation: { isRequired: true },
        }),
        heroTitle: fields.text({
          label: 'Homepage Hero Title',
          validation: { isRequired: true },
        }),
        heroSubtitle: fields.text({
          label: 'Homepage Hero Subtitle',
          multiline: true,
        }),
        heroCta: fields.text({
          label: 'Hero CTA Button Text',
          description: 'Text for the call-to-action button on the homepage hero.',
        }),
        ogImage: fields.image({
          label: 'Default Social Image (OG)',
          directory: 'public/images',
          publicPath: '/images/',
          description: 'Default image for social sharing (1200x630 recommended).',
        }),
        socialLinks: fields.array(
          fields.object({
            platform: fields.select({
              label: 'Platform',
              options: [
                { label: 'Twitter / X', value: 'twitter' },
                { label: 'Bluesky', value: 'bluesky' },
                { label: 'GitHub', value: 'github' },
                { label: 'Mastodon', value: 'mastodon' },
              ],
              defaultValue: 'twitter',
            }),
            url: fields.url({
              label: 'URL',
              validation: { isRequired: true },
            }),
          }),
          {
            label: 'Social Links',
            itemLabel: (props) => props.fields.platform.value || 'New link',
          }
        ),
        footerText: fields.text({
          label: 'Footer Disclaimer',
          multiline: true,
          description: 'Legal or editorial disclaimer shown in the site footer.',
        }),
      },
    }),
  },

  collections: {
    // ─── Articles ────────────────────────────────────────────────────
    articles: collection({
      label: 'Articles',
      slugField: 'title',
      path: 'src/content/articles/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['status', 'source', 'articleType', 'publishedAt'],
      parseSlugForSort: (slug) => {
        // Extract date prefix for reverse-chronological sort (newest first)
        const match = slug.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? -new Date(match[1]).getTime() : 0;
      },
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
          label: 'Source Outlet',
          validation: { isRequired: true },
          description: 'The original news outlet (e.g., "AP News", "Reuters").',
        }),
        sourceUrl: fields.url({
          label: 'Source URL',
          validation: { isRequired: true },
        }),
        summary: fields.text({
          label: 'Summary',
          multiline: true,
          validation: { isRequired: true },
          description: 'Displayed on article cards and used for SEO meta description.',
        }),
        image: fields.image({
          label: 'Featured Image',
          directory: 'public/images/articles',
          publicPath: '/images/articles/',
          description: 'Hero image for the article. 16:9 aspect ratio recommended.',
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
              'Full filename without .md (e.g., 2026-02-13-article-title).',
          }
        ),
        tags: fields.array(
          fields.text({ label: 'Tag' }),
          {
            label: 'Tags',
            itemLabel: (props) => props.value ?? 'Add a tag',
          }
        ),
        aiGenerated: fields.checkbox({
          label: 'AI Generated',
          defaultValue: true,
          description: 'Uncheck if written by a human editor.',
        }),
        reviewedBy: fields.text({
          label: 'Reviewed By',
        }),
        reviewedAt: fields.datetime({
          label: 'Reviewed At',
        }),
        confidence: fields.number({
          label: 'AI Confidence (0-1)',
          validation: { min: 0, max: 1 },
          description: 'How confident the AI is in the article relevance.',
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
      columns: ['role', 'category'],
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
          description: 'Primary role or title (e.g., "Financier", "U.S. Senator").',
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
          label: 'Short Bio',
          multiline: true,
          validation: { isRequired: true },
          description: 'Displayed on people cards (2-3 sentences).',
        }),
        image: fields.image({
          label: 'Photo',
          directory: 'public/images/people',
          publicPath: '/images/people/',
          description: 'Headshot or photo. Square aspect ratio recommended.',
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
      columns: ['era', 'date', 'category', 'significance'],
      schema: {
        title: fields.slug({
          name: {
            label: 'Event Title',
            validation: { isRequired: true },
          },
        }),
        era: fields.select({
          label: 'Era',
          description: 'Which period of the Epstein case does this event belong to?',
          options: [
            { label: 'Origins & Network Building (1976-2004)', value: 'origins' },
            { label: 'First Prosecution (2005-2011)', value: 'first-prosecution' },
            { label: 'Public Exposure (2014-2018)', value: 'exposure' },
            { label: 'Arrest & Death (2019)', value: 'reckoning' },
            { label: 'Aftermath & Accountability (2020-2024)', value: 'aftermath' },
            { label: 'The Transparency Era (2025-Present)', value: 'transparency' },
          ],
          defaultValue: 'origins',
        }),
        date: fields.date({
          label: 'Date',
          validation: { isRequired: true },
        }),
        endDate: fields.date({
          label: 'End Date',
          description: 'Optional — for events spanning a date range.',
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
            { label: 'Civil Litigation', value: 'civil-litigation' },
            { label: 'Network', value: 'network' },
            { label: 'Other', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        significance: fields.select({
          label: 'Significance',
          description:
            'Major events get larger visual treatment on the timeline page.',
          options: [
            { label: 'Major', value: 'major' },
            { label: 'Standard', value: 'standard' },
            { label: 'Minor', value: 'minor' },
          ],
          defaultValue: 'standard',
        }),
        summary: fields.text({
          label: 'Summary',
          multiline: true,
          validation: { isRequired: true },
          description: 'Brief description shown on timeline cards.',
        }),
        image: fields.image({
          label: 'Event Image',
          directory: 'public/images/timeline',
          publicPath: '/images/timeline/',
          description:
            'Optional photo (courtroom, location, document, etc.). 16:9 recommended.',
        }),
        imageCaption: fields.text({
          label: 'Image Caption / Credit',
          description: 'Attribution or description for the image.',
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
        relatedEvents: fields.array(
          fields.relationship({
            label: 'Event',
            collection: 'timeline',
          }),
          {
            label: 'Related Events',
            itemLabel: (props) => props.value ?? 'Select an event',
            description: 'Cross-reference other timeline events.',
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
          description: 'Lower numbers appear first within the same date.',
        }),
        content: fields.markdoc({
          label: 'Full Details',
          extension: 'md',
          description:
            'Detailed description shown on the individual event page.',
        }),
      },
    }),

    // ─── Survivors ───────────────────────────────────────────────────
    survivors: collection({
      label: 'Survivors & Witnesses',
      slugField: 'title',
      path: 'src/content/survivors/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['type', 'publishedAt', 'anonymous'],
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
        image: fields.image({
          label: 'Featured Image',
          directory: 'public/images/survivors',
          publicPath: '/images/survivors/',
          description: 'Optional image for this entry.',
        }),
        imageCaption: fields.text({
          label: 'Image Caption / Credit',
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
          description: 'Check if the survivor identity is withheld.',
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
