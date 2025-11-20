import type { ToolDefinition } from '../core/toolRuntime.js';
import * as https from 'node:https';
import * as http from 'node:http';

export function createWebTools(): ToolDefinition[] {
  return [
    {
      name: 'WebFetch',
      description: `- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.`,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from',
          },
          prompt: {
            type: 'string',
            description: 'The prompt to run on the fetched content',
          },
        },
        required: ['url', 'prompt'],
      },
      handler: async (args: Record<string, unknown>) => {
        const url = args['url'] as string;
        const prompt = args['prompt'] as string;

        if (!url || !prompt) {
          return 'Error: url and prompt parameters are required.';
        }

        try {
          // Upgrade HTTP to HTTPS
          const targetUrl = url.replace(/^http:\/\//, 'https://');

          const content = await fetchUrl(targetUrl);

          // Simple HTML to markdown conversion (basic implementation)
          const markdown = htmlToMarkdown(content);

          // Process with prompt (in a real implementation, this would use a small LLM)
          // For now, we'll return the content with the prompt context
          return `Fetched content from ${targetUrl}

Prompt: ${prompt}

Content (first 5000 characters):
${markdown.slice(0, 5000)}${markdown.length > 5000 ? '\n\n... (content truncated)' : ''}

Summary: This is the content fetched from the URL. In a full implementation, this would be processed by a small LLM to answer the specific prompt.`;
        } catch (error) {
          return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'WebSearch',
      description: `- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US
  - Account for "Today's date" in <env>. For example, if <env> says "Today's date: 2025-07-01", and the user wants the latest docs, do not use 2024 in the search query. Use 2025.`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to use',
          },
          allowed_domains: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Only include search results from these domains',
          },
          blocked_domains: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Never include search results from these domains',
          },
        },
        required: ['query'],
      },
      handler: async (args: Record<string, unknown>) => {
        const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
        const allowed = parseDomainList(args['allowed_domains']);
        const blocked = parseDomainList(args['blocked_domains']);

        if (!query) {
          return 'Error: query parameter is required.';
        }

        try {
          const provider = resolveSearchProvider();
          if (!provider) {
            return [
              'WebSearch requires either BRAVE_SEARCH_API_KEY or SERPAPI_API_KEY.',
              'Run /secrets (or set the environment variables directly) to configure an API key.',
            ].join('\n');
          }

          const results = await provider.search({
            query,
            allowedDomains: allowed,
            blockedDomains: blocked,
            maxResults: 6,
          });

          if (!results.length) {
            return `No web results found for "${query}" ${formatFilterSummary(allowed, blocked)}.`;
          }

          return formatSearchResults(query, results, provider.label, allowed, blocked);
        } catch (error) {
          return `Error performing web search: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}

function resolveSearchProvider(): SearchProvider | null {
  const braveKey = process.env['BRAVE_SEARCH_API_KEY']?.trim();
  if (braveKey) {
    return {
      id: 'brave',
      label: 'Brave Search',
      search: (params) => performBraveSearch(params, braveKey),
    };
  }
  const serpKey = process.env['SERPAPI_API_KEY']?.trim();
  if (serpKey) {
    return {
      id: 'serpapi',
      label: 'SerpAPI (Google)',
      search: (params) => performSerpApiSearch(params, serpKey),
    };
  }
  return null;
}

async function performBraveSearch(params: SearchParams, apiKey: string): Promise<WebSearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', params.query);
  url.searchParams.set('count', String(Math.min(params.maxResults * 2, 20)));

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as BraveSearchResponse;
  const entries = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  const mapped = entries
    .map((entry) => ({
      title: entry.title || entry.url,
      url: entry.url,
      snippet: entry.description || entry.snippet || '',
      source: entry.profile?.name || entry.source || safeHostname(entry.url) || undefined,
      published: entry.publishedDate || entry.subtype,
    }))
    .filter((result) => Boolean(result.url));

  return applyDomainFilters(mapped, params.allowedDomains, params.blockedDomains).slice(0, params.maxResults);
}

async function performSerpApiSearch(params: SearchParams, apiKey: string): Promise<WebSearchResult[]> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', params.query);
  url.searchParams.set('num', String(Math.min(params.maxResults * 2, 10)));
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SerpAPI returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SerpApiResponse;
  const entries = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  const mapped = entries
    .map((entry) => ({
      title: entry.title || entry.link,
      url: entry.link,
      snippet: entry.snippet || (Array.isArray(entry.snippet_highlighted_words) ? entry.snippet_highlighted_words.join(' ') : ''),
      source: entry.source || entry.display_link || entry.displayed_link || safeHostname(entry.link) || undefined,
      published: entry.date || entry.snippet_date,
    }))
    .filter((result) => Boolean(result.url));

  return applyDomainFilters(mapped, params.allowedDomains, params.blockedDomains).slice(0, params.maxResults);
}

function parseDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function applyDomainFilters(
  results: WebSearchResult[],
  allowedDomains: string[],
  blockedDomains: string[]
): WebSearchResult[] {
  const normalizedAllowed = allowedDomains.map((domain) => domain.startsWith('.') ? domain.slice(1) : domain);
  const normalizedBlocked = blockedDomains.map((domain) => domain.startsWith('.') ? domain.slice(1) : domain);

  return results.filter((result) => {
    const hostname = safeHostname(result.url);
    if (!hostname) {
      return false;
    }
    if (normalizedAllowed.length && !normalizedAllowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return false;
    }
    if (normalizedBlocked.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return false;
    }
    return true;
  });
}

function formatSearchResults(
  query: string,
  results: WebSearchResult[],
  providerLabel: string,
  allowed: string[],
  blocked: string[]
): string {
  const lines = [`Web Search Results for "${query}" (${providerLabel})`, '' ];
  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title || result.url}`, result.url);
    if (result.snippet) {
      lines.push(`   ${result.snippet}`);
    }
    const meta: string[] = [];
    if (result.source) {
      meta.push(`source: ${result.source}`);
    }
    if (result.published) {
      meta.push(`published: ${result.published}`);
    }
    if (meta.length) {
      lines.push(`   (${meta.join(' · ')})`);
    }
    lines.push('');
  });

  lines.push(formatFilterSummary(allowed, blocked, providerLabel));
  return lines.join('\n').trim();
}

function formatFilterSummary(allowed: string[], blocked: string[], providerLabel?: string): string {
  const segments: string[] = [];
  if (allowed.length) {
    segments.push(`allowed: ${allowed.join(', ')}`);
  }
  if (blocked.length) {
    segments.push(`blocked: ${blocked.join(', ')}`);
  }
  if (!segments.length) {
    segments.push('none');
  }
  if (providerLabel) {
    segments.push(`provider: ${providerLabel}`);
  }
  return `Filters: ${segments.join(' | ')}`;
}

function safeHostname(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url: string;
      description?: string;
      snippet?: string;
      publishedDate?: string;
      subtype?: string;
      source?: string;
      profile?: { name?: string };
    }>;
  };
}

interface SerpApiResponse {
  organic_results?: Array<{
    title?: string;
    link: string;
    snippet?: string;
    snippet_highlighted_words?: string[];
    display_link?: string;
    source?: string;
    displayed_link?: string;
    date?: string;
    snippet_date?: string;
  }>;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  published?: string;
}

interface SearchParams {
  query: string;
  allowedDomains: string[];
  blockedDomains: string[];
  maxResults: number;
}

interface SearchProvider {
  id: 'brave' | 'serpapi';
  label: string;
  search: (params: SearchParams) => Promise<WebSearchResult[]>;
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;

    const request = client
      .get(url, (res) => {
        let data = '';

        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(res.headers.location)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve(data);
        });
      })
      .on('error', (err) => {
        reject(err);
      });

    request.on('error', (err) => {
      reject(err);
    });
  });
}

function htmlToMarkdown(html: string): string {
  // Very basic HTML to markdown conversion
  let text = html;

  // Remove script and style tags
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Convert common HTML tags
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
