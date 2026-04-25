# Insurable Buddy

An AI-powered insurance assistant chatbot for [Insurable.dev](https://insurable.dev). Built with a ReAct agent that searches a knowledge base, browses the web, and books calendar calls — all through a conversational chat interface.

## Features

- **ReAct Agent** — multi-step reasoning loop (Thought → Action → Observation → Answer)
- **RAG (Retrieval-Augmented Generation)** — searches Pinecone vector knowledge base for company/product info
- **Web Search** — real-time search via Tavily for news, regulations, and market data
- **Call Booking** — books 30-minute Google Calendar appointments and logs them to Google Sheets
- **Conversation Memory** — maintains context across messages within a session
- **Session Persistence** — all chats stored in PostgreSQL for review via pgAdmin

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Axios, React-Markdown |
| Backend | Node.js + Express |
| LLM | Groq (llama-3.3-70b-versatile) |
| Vector DB | Pinecone |
| Web Search | Tavily |
| Calendar | Google Calendar API (OAuth2) |
| Spreadsheet | Google Sheets API |
| Database | PostgreSQL |

## Project Structure

```
insurablebuddy/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   └── reactAgent.js         # ReAct loop, tool execution, system prompt
│   │   ├── controllers/
│   │   │   └── chatController.js     # Request validation, sanitization
│   │   ├── routes/
│   │   │   └── chat.js               # API routes
│   │   ├── services/
│   │   │   ├── calendarService.js    # Google Calendar booking + validation
│   │   │   ├── sheetsService.js      # Google Sheets logging
│   │   │   ├── pineconeService.js    # Vector search (RAG)
│   │   │   ├── tavilyService.js      # Web search
│   │   │   └── dbService.js          # PostgreSQL session/message storage
│   │   ├── scripts/
│   │   │   ├── getRefreshToken.js    # One-time Google OAuth2 token generator
│   │   │   └── indexKnowledge.js     # Index knowledge base into Pinecone
│   │   └── server.js                 # Express server + rate limiting
│   ├── knowledge/                    # .txt knowledge base files
│   ├── google-credentials.json       # Google OAuth2 client credentials
│   └── .env                          # Environment variables (never commit)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                   # Chat UI
│   │   ├── App.css                   # Styles
│   │   └── main.jsx                  # React entry point
│   └── index.html
├── PROJECT_STRUCTURE.txt
└── README.md
```

## Prerequisites

- Node.js v18+
- PostgreSQL (running locally or hosted)
- Groq API key — [console.groq.com](https://console.groq.com)
- Pinecone account — [pinecone.io](https://www.pinecone.io)
- Tavily API key — [tavily.com](https://tavily.com)
- Google Cloud project with Calendar and Sheets APIs enabled

## Setup

### 1. Install dependencies

```bash
npm run install-all
```

### 2. Configure environment variables

Create `backend/.env`:

```env
# LLM
GROQ_API_KEY=your_groq_api_key

# Vector search
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=knowledge-base

# Web search
TAVILY_API_KEY=your_tavily_api_key

# Google (Calendar + Sheets)
GOOGLE_CALENDAR_ID=your_gmail@gmail.com
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_REFRESH_TOKEN=your_refresh_token   # generated in step 4

# PostgreSQL
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/insurablebuddy

# Server
PORT=3001
```

### 3. Set up PostgreSQL

Create the database in pgAdmin or psql:

```sql
CREATE DATABASE insurablebuddy;
```

Tables are created automatically when the server first starts.

### 4. Generate Google refresh token

Place your `google-credentials.json` (OAuth2 desktop client) in the `backend/` folder, then run:

```bash
cd backend
node src/scripts/getRefreshToken.js
```

Follow the browser prompt, paste the code back, and copy the refresh token into your `.env`.

### 5. Index the knowledge base

Add `.txt` files to `backend/knowledge/`, then run:

```bash
cd backend
npm run index-knowledge
```

### 6. Run the app

Start Postgres first, then:

```bash
# From root — starts backend + frontend together
npm run dev
```

Or separately:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Viewing chat history

Open pgAdmin, connect to the `insurablebuddy` database, open the Query Tool, and run:

```sql
-- All sessions
SELECT * FROM sessions;

-- All messages (newest first)
SELECT * FROM chat_history;

-- Messages for one session
SELECT * FROM get_session('your-session-id');
```

## API

### POST `/api/chat/message`

```json
// Request
{
  "message": "I'd like to book a call",
  "conversationHistory": [],
  "userTimezone": "Europe/London",
  "sessionId": "uuid"
}

// Response
{
  "message": "I've booked this time for you! Here's your calendar link: ...",
  "sources": []
}
```

## Deployment

| Part | Recommended platforms |
|---|---|
| Backend | Railway, Render, Heroku |
| Frontend | Vercel, Netlify |
| Database | Supabase, Railway Postgres, Neon |

Before deploying, update `API_URL` in `frontend/src/App.jsx` to your production backend URL.

## License

MIT
