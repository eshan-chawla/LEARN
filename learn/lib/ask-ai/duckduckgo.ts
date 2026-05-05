export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

interface DuckDuckGoTopic {
  Text?: unknown;
  FirstURL?: unknown;
  Topics?: unknown;
}

interface DuckDuckGoPayload {
  Heading?: unknown;
  AbstractText?: unknown;
  AbstractURL?: unknown;
  AbstractSource?: unknown;
  Answer?: unknown;
  AnswerType?: unknown;
  RelatedTopics?: unknown;
  Results?: unknown;
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getHostName(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'DuckDuckGo';
  }
}

function collectTopics(value: unknown, results: WebSearchResult[]) {
  if (!Array.isArray(value)) return;

  for (const item of value as DuckDuckGoTopic[]) {
    if (!item || typeof item !== 'object') continue;

    const nestedTopics = (item as DuckDuckGoTopic).Topics;
    if (Array.isArray(nestedTopics)) {
      collectTopics(nestedTopics, results);
      continue;
    }

    const snippet = getString((item as DuckDuckGoTopic).Text);
    const url = getString((item as DuckDuckGoTopic).FirstURL);
    if (!snippet || !url) continue;

    const title = snippet.split(' - ')[0]?.trim() || getHostName(url);
    results.push({
      title,
      snippet,
      url,
      source: getHostName(url),
    });
  }
}

export async function searchDuckDuckGoContext(
  query: string,
  limit = 5
): Promise<WebSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', trimmedQuery);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('skip_disambig', '1');

    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json().catch(() => null)) as DuckDuckGoPayload | null;
    if (!payload) return [];

    const results: WebSearchResult[] = [];
    const heading = getString(payload.Heading);
    const abstractText = getString(payload.AbstractText);
    const abstractUrl = getString(payload.AbstractURL);
    const abstractSource = getString(payload.AbstractSource) || getHostName(abstractUrl);

    if (abstractText && abstractUrl) {
      results.push({
        title: heading || abstractSource,
        snippet: abstractText,
        url: abstractUrl,
        source: abstractSource,
      });
    }

    const answer = getString(payload.Answer);
    if (answer) {
      results.push({
        title: heading || getString(payload.AnswerType) || 'DuckDuckGo answer',
        snippet: answer,
        url: abstractUrl || 'https://duckduckgo.com/',
        source: 'DuckDuckGo',
      });
    }

    collectTopics(payload.Results, results);
    collectTopics(payload.RelatedTopics, results);

    const seen = new Set<string>();
    return results
      .filter((result) => {
        const key = `${result.url}:${result.snippet}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function formatWebSearchContext(results: WebSearchResult[]) {
  return results
    .map((result, index) =>
      [
        `Web result ${index + 1}`,
        `Source title: ${result.title}`,
        `Source: ${result.source}`,
        `URL: ${result.url}`,
        result.snippet,
      ].join('\n')
    )
    .join('\n\n---\n\n');
}
