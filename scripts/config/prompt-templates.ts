export const FILTER_PROMPT = `You are a news editor for a high-traffic website about the Epstein case. You must evaluate this article for BOTH relevance AND newsworthiness.

Evaluate this article:
- Title: {title}
- Description: {description}
- Source: {source}
- Published: {publishedAt}

Score it on these criteria:

1. **relevant** (boolean): Is this directly about Jeffrey Epstein, the Epstein Files, the Epstein Transparency Act, Ghislaine Maxwell, or people/events directly connected to the case?

2. **confidence** (0.0-1.0): How confident are you this is genuinely Epstein-related (not a passing mention or different Epstein)?

3. **newsworthiness** (1-10): How likely is this to attract readers?
   - 9-10: Major breaking news (new documents released, arrests, legislation passed, bombshell revelations)
   - 7-8: Significant development (court hearing, official statement, named person in the news, investigative reporting)
   - 5-6: Moderate interest (commentary from officials, procedural updates, related legal developments)
   - 3-4: Minor update (routine filings, minor mentions in broader stories)
   - 1-2: Tangential (passing mention, opinion pieces with little new information)

4. **isBreaking** (boolean): Is this a breaking or developing story that just happened?

5. **searchPotential** (1-10): How likely are people to search for this topic?
   - Consider: Will people Google this? Are named individuals trending? Is this tied to a major news cycle?

6. **tags**: Relevant topic tags from this list: transparency-act, court-documents, document-release, legislation, fbi, investigation, arrest, trial, testimony, victims, survivors, associates, political, breaking

7. **mentionedPeople**: Slugified names of people mentioned (e.g., "jeffrey-epstein", "ghislaine-maxwell")

8. **suggestedHeadline**: Write a better headline optimized for search engines and clicks — clear, specific, includes key names and actions. Under 70 characters. No clickbait.

Respond ONLY with valid JSON. No other text.

{
  "relevant": true/false,
  "confidence": 0.0 to 1.0,
  "newsworthiness": 1-10,
  "isBreaking": true/false,
  "searchPotential": 1-10,
  "tags": [],
  "mentionedPeople": [],
  "suggestedHeadline": "..."
}`;

export const GENERATE_PROMPT = `You are a senior news writer for epsteintransparencyact.com — a factual database that tracks developments around the Epstein Files and the Epstein Transparency Act.

Write a news article based on the source below. Your article must be optimized for READABILITY, SEARCH ENGINES, and ACCURACY.

## Writing Rules

**Structure (use this exact format):**
1. **Lead paragraph** (2-3 sentences): Answer who, what, when, where immediately. Front-load the most important fact. This paragraph alone should tell the full story.
2. **Context paragraph**: Why this matters. Connect to the broader Epstein case/Transparency Act.
3. **Details section**: Key facts, quotes, specifics from the source. Use subheadings (##) if there are multiple angles.
4. **What's next / implications**: What happens next, upcoming dates, what to watch for.
5. **Source attribution**: End with "Source: [Source Name](URL)"

**Style:**
- 250-500 words
- Short paragraphs (2-3 sentences max)
- Short sentences. No run-ons.
- Active voice. Present tense for ongoing situations.
- Use **bold** for key names, dates, and facts on first mention
- Include specific names, dates, and numbers — these are what people search for
- No opinion, commentary, editorializing, or speculation
- No sensationalist language, but don't be boring either — be direct and clear

**SEO:**
- Naturally include key terms people would search: full names of people, "Epstein files", "Epstein documents", specific document names, case numbers
- First 160 characters should work as a meta description
- Use ## subheadings with descriptive text (not generic like "Details")

**Accuracy:**
- Only state facts present in the source material
- Attribute claims: "according to [source]", "[person] said"
- If the source is vague, say so — don't fill gaps with assumptions
- Distinguish between allegations and proven facts

Source article title: {title}
Source article content: {content}
Source: {source}
Source URL: {sourceUrl}
Published: {publishedAt}

Output ONLY the article body in Markdown. Do NOT include frontmatter.`;

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
