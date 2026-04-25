import { reactAgent } from '../agents/reactAgent.js';
import { upsertSession, saveMessage } from '../services/dbService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_MESSAGE_LENGTH  = 2_000;   // chars
const MAX_HISTORY_ITEMS   = 20;      // message turns
const MAX_HISTORY_CONTENT = 1_000;   // chars per history item
const VALID_ROLES         = new Set(['user', 'assistant']);

// ---------------------------------------------------------------------------
// Strip non-printable characters (keeps newlines/tabs)
// ---------------------------------------------------------------------------
function sanitizeText(str) {
  // Remove ASCII control characters except \t (9), \n (10), \r (13)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ---------------------------------------------------------------------------
// Validate and sanitize the conversation history array from the client.
// We never trust the client to send valid role/content pairs.
// ---------------------------------------------------------------------------
function parseHistory(raw) {
  if (!Array.isArray(raw)) return [];

  const sliced   = raw.slice(-MAX_HISTORY_ITEMS);
  const filtered = sliced.filter(item =>
    item !== null &&
    typeof item === 'object' &&
    VALID_ROLES.has(item.role) &&
    typeof item.content === 'string' &&
    item.content.trim().length > 0
  );

  if (filtered.length < sliced.length) {
    console.warn(`[chatController] dropped ${sliced.length - filtered.length} invalid history item(s)`);
  }

  return filtered.map(item => ({
    role: item.role,
    content: sanitizeText(item.content.trim().slice(0, MAX_HISTORY_CONTENT)),
  }));
}

// ---------------------------------------------------------------------------
// POST /api/chat/message
// ---------------------------------------------------------------------------
export async function processMessage(req, res) {
  try {
    const { message, conversationHistory, userTimezone, sessionId } = req.body;

    // Validate timezone — must be a real IANA format (e.g. "Asia/Singapore")
    const IANA_TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z0-9_\/+-]+$/;
    const safeTimezone = (typeof userTimezone === 'string' && IANA_TZ_REGEX.test(userTimezone.trim()))
      ? userTimezone.trim()
      : 'Europe/London';

    // --- Validate message ---
    if (message === undefined || message === null) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (typeof message !== 'string') {
      return res.status(400).json({ error: 'message must be a string' });
    }

    const sanitizedMessage = sanitizeText(message.trim()).slice(0, MAX_MESSAGE_LENGTH);

    if (sanitizedMessage.length === 0) {
      return res.status(400).json({ error: 'message cannot be empty' });
    }

    // --- Validate history ---
    const sanitizedHistory = parseHistory(conversationHistory);

    // --- Run agent ---
    const response = await reactAgent(sanitizedMessage, sanitizedHistory, safeTimezone);

    // --- Persist to PostgreSQL (fire-and-forget, never block the response) ---
    if (sessionId && typeof sessionId === 'string' && sessionId.length <= 100) {
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
      upsertSession(safeSessionId, safeTimezone)
        .then(() => Promise.all([
          saveMessage(safeSessionId, 'user', sanitizedMessage, null),
          saveMessage(safeSessionId, 'assistant', response.message, response.sources ?? null),
        ]))
        .catch(err => console.error('[chatController] db save error:', err.message));
    }

    return res.json(response);
  } catch (error) {
    // Log internally with enough detail for debugging; never expose to client
    console.error('[chatController] error processing message:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: 'Failed to process message' });
  }
}
