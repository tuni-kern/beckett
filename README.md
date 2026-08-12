# Beckett

Your personal AI assistant, powered by Claude. Runs on Telegram, remembers everything, works 24/7.

Beckett connects your Telegram to Claude through a persistent relay with semantic memory. It remembers your conversations, learns your preferences, and gets smarter over time. Set it up once, and it runs in the background forever.

## What It Does

- **Persistent memory** — Beckett remembers facts, goals, and context across every conversation
- **Semantic search** — Finds relevant past conversations automatically using vector embeddings
- **Personalized to you** — Knows your name, timezone, work, schedule, and communication style
- **Understands voice notes** — Send a voice message, it transcribes and replies (Groq or local Whisper)
- **Runs 24/7** — Set it up as a background service and forget about it
- **Guided setup** — Claude Code walks you through every step. No config files to edit manually.

## Quick Start

```bash
git clone https://github.com/tuni-kern/beckett.git
cd beckett
bun install
bun run setup
```

The setup script checks your prerequisites, then [Claude Code](https://docs.anthropic.com/en/docs/claude-code) reads `CLAUDE.md` and walks you through configuration step by step:

1. **Telegram Bot** (~3 min) — Create a bot, connect it
2. **Database & Memory** (~12 min) — Set up Supabase for persistent memory and semantic search
3. **Personalize** (~3 min) — Tell it about you
4. **Test** (~2 min) — Send a message, get a response
5. **Always On** (~5 min) — Run it as a background service

Total setup time: ~25 minutes.

## How It Works

```
You (Telegram) → Beckett (Grammy bot) → Claude Code CLI → Response
                       ↕
                 Supabase (PostgreSQL + pgvector)
                 ├── messages (conversation history)
                 ├── memory (facts, goals, preferences)
                 └── semantic search (vector embeddings)
```

Every message you send goes through the Telegram bot to Claude. Claude gets your full context: recent conversation history, relevant memories found via semantic search, and your personal profile. Responses come back to Telegram.

Memory works automatically. Claude extracts facts and goals from conversations and stores them. On every new message, semantic search finds the most relevant past context and includes it in the prompt.

## Requirements

- [Bun](https://bun.sh/) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Telegram account + bot token (free, created during setup)
- [Supabase](https://supabase.com/) project (free tier works)
- OpenAI API key (for generating text embeddings, stored in Supabase)

## What's Included

| File | Purpose |
|------|---------|
| `src/relay.ts` | Core Telegram relay — routes messages through Claude |
| `src/context.ts` | Builds context from Supabase (history, memory, profile) |
| `src/memory.ts` | Extracts and stores facts, goals, and completions |
| `src/transcribe.ts` | Voice note transcription — Groq cloud or local Whisper |
| `db/schema.sql` | PostgreSQL schema for messages, memory, and logs |
| `supabase/functions/embed/` | Auto-generates vector embeddings on insert |
| `supabase/functions/search/` | Semantic search endpoint |
| `examples/smart-checkin.ts` | Proactive check-in pattern (optional) |
| `examples/morning-briefing.ts` | Daily briefing pattern (optional) |

## What's Coming

Beckett is the foundation. The full version adds:

- **Voice replies** — Your assistant talks back with a real voice
- **Phone calls** — Give your assistant a real phone number via Vapi
- **Proactive outreach** — Smart check-ins that only message you when it matters
- **Real integrations** — Gmail, Google Calendar, task management connected via MCP
- **Multi-agent routing** — Specialized agents for research, content, finance, strategy

Get the full version with video walkthroughs:
- **YouTube:** [Tech With Tuni](https://youtube.com/@TechWithTuni) — tutorials and live builds
- **Community:** [The Agent Lab](https://www.skool.com/the-agent-lab-3890) — courses, support, done-for-you setups

## License

MIT

## Built By

[Tuni Kern](https://linkedin.com/in/tuni-kern) — AI Engineer, San Diego. Follow the build on [YouTube](https://youtube.com/@TechWithTuni).
