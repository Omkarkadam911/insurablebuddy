import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TAVILY_API_URL = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 12_000; // 12 s — Tavily SLA is typically <5 s

// ---------------------------------------------------------------------------
// searchWeb — query Tavily and return structured results.
//
// CHANGED FROM ORIGINAL:
// - Adds a hard request timeout (axios `timeout` option).
// - Returns `error` field instead of silently swallowing failures.
//   The caller (reactAgent) can surface a meaningful message to the LLM
//   rather than treating a Tavily outage as "no results found".
// - Validates the API key is configured before making the network call.
// ---------------------------------------------------------------------------
export async function searchWeb(query, maxResults = 5) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error('[tavilyService] TAVILY_API_KEY is not set');
    return { answer: null, results: [], error: 'Web search is not configured' };
  }

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { answer: null, results: [], error: 'Empty search query' };
  }

  console.log(`[tavilyService] searching: ${query.trim().slice(0, 100)}`);

  try {
    const response = await axios.post(
      TAVILY_API_URL,
      {
        api_key: apiKey,
        query:   query.trim(),
        max_results: Math.min(maxResults, 10), // cap to avoid large payloads
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: false,
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
        // Validate status explicitly so 4xx/5xx throw instead of returning
        validateStatus: status => status === 200,
      }
    );

    const { results = [], answer } = response.data;
    console.log(`[tavilyService] got ${results.length} results`);

    return {
      answer: answer || null,
      results: results.map(r => ({
        title:   r.title   || '',
        url:     r.url     || '',
        content: r.content || '',
        score:   r.score   || 0,
      })),
      error: null,
    };

  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
    const status    = err.response?.status;

    console.error('[tavilyService] search failed:', {
      message: err.message,
      status,
      isTimeout,
    });

    // Return a structured error so the agent knows WHY results are empty
    const errorMsg = isTimeout
      ? 'Web search timed out'
      : status === 401 ? 'Web search API key is invalid'
      : status === 429 ? 'Web search rate limit exceeded'
      : 'Web search unavailable';

    return { answer: null, results: [], error: errorMsg };
  }
}
