export const FILTER_PROMPT = `You are a news relevance classifier. Determine if the following article is related to:
- Jeffrey Epstein
- The Epstein Files
- The Epstein Transparency Act
- Ghislaine Maxwell
- Any legal proceedings, document releases, or investigations directly related to the Epstein case
- People directly named in Epstein-related court documents

Respond ONLY with valid JSON. No other text.

Article title: {title}
Article description: {description}
Article source: {source}

Response format:
{
  "relevant": true/false,
  "confidence": 0.0 to 1.0,
  "tags": ["transparency-act", "court-documents", "document-release", "legislation", "fbi", "investigation", etc.],
  "mentionedPeople": ["jeffrey-epstein", "ghislaine-maxwell", etc. — use slugified names]
}`;

export const GENERATE_PROMPT = `You are a factual news summarizer for the Epstein Transparency Act project. Write a concise, factual news summary based on the source article below.

Requirements:
- 200-400 words
- Pure factual reporting — NO opinion, commentary, editorializing, or speculation
- Include key facts: who, what, when, where
- Include direct quotes if available in the source (attributed properly)
- Reference the original source at the end
- Write in a neutral, professional news wire style
- Do NOT use sensationalist language

Source article title: {title}
Source article content: {content}
Source: {source}
Source URL: {sourceUrl}
Published: {publishedAt}

Output the article body in Markdown format. Do NOT include frontmatter — just the body content.`;

export const GENERATE_FRONTMATTER_PROMPT = `Based on the following news article, generate ONLY the YAML frontmatter metadata. No other text.

Article title: {title}
Article source: {source}
Article source URL: {sourceUrl}
Article published date: {publishedAt}
Article summary (first 2 sentences): {summary}

Known people slugs in our database: {knownPeopleSlugs}

Output ONLY valid YAML frontmatter (without the --- delimiters):
title: "the article title — rewrite for clarity if needed"
publishedAt: YYYY-MM-DD
source: "Source Name"
sourceUrl: "https://..."
summary: "1-2 sentence summary of the article"
people:
  - slug-of-person-mentioned
tags:
  - relevant-tag
status: published
aiGenerated: true
confidence: 0.0 to 1.0`;
