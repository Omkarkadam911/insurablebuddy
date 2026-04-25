import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRoutes from './routes/chat.js';
import { initDb } from './services/dbService.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Fail fast if any required env var is missing — avoids cryptic runtime errors
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS = [
  'GROQ_API_KEY',
  'PINECONE_API_KEY',
  'PINECONE_INDEX_NAME',
  'TAVILY_API_KEY',
  'GOOGLE_CREDENTIALS',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_SHEET_ID',
  'GOOGLE_CALENDAR_ID',
  'DATABASE_URL',
];
const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`[server] Missing required environment variables:\n  ${missingVars.join('\n  ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// CORS — restrict to known frontend origin; never wildcard in production
// ---------------------------------------------------------------------------
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type'],
}));

// ---------------------------------------------------------------------------
// Body parsing — hard cap at 16 KB to prevent abuse / token inflation
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '16kb' }));

// ---------------------------------------------------------------------------
// Rate limiting — simple in-process token-bucket per IP.
// Replace with express-rate-limit + Redis in production for multi-process.
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 60_000;   // 1 minute
const RATE_MAX_REQS  = 20;       // 20 requests per minute per IP

const rateBuckets = new Map(); // ip → { count, resetAt }

// Prune stale entries every 5 minutes to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, 5 * 60_000).unref();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();

  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
  }
  bucket.count++;
  rateBuckets.set(ip, bucket);

  if (bucket.count > RATE_MAX_REQS) {
    return res.status(429).json({
      error: 'Too many requests. Please wait before sending another message.',
    });
  }
  next();
}

app.use(rateLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/chat', chatRoutes);

// ---------------------------------------------------------------------------
// Health check — basic liveness probe (not a deep readiness check)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Global error handler — never leak internal details to clients
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} | CORS origin: ${ALLOWED_ORIGIN}`);
    });
  })
  .catch(err => {
    console.error('[server] failed to initialise database:', err.message);
    process.exit(1);
  });
