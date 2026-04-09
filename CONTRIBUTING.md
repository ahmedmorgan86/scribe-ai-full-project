# Contributing to ai-social-engine

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Python 3.11+ (for workers)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/dtsatskin/ai-social-engine.git
cd ai-social-engine

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local
# Edit .env.local with your API keys

# Start infrastructure (Qdrant, LiteLLM, LangGraph, Stylometry workers)
docker compose up -d

# Initialize database
npm run db:init

# Start development server
npm run dev
```

### Running Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests (requires dev server running)
npm run test:e2e

# Test coverage
npm run test:coverage
```

## How to Contribute

### Reporting Bugs

1. Check existing issues first
2. Include reproduction steps
3. Include expected vs actual behavior
4. Include environment details (OS, Node version, etc.)

### Suggesting Features

1. Open an issue with the `feature` label
2. Describe the use case
3. Explain why existing features don't cover it

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Write tests first (TDD approach)
4. Implement the feature
5. Ensure all tests pass (`npm test && npm run typecheck`)
6. Commit with conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
7. Open a PR with a clear description

### Code Style

- **TypeScript** for all new code
- **Immutable patterns** - never mutate objects, always create new ones
- **Small files** - aim for 200-400 lines, max 800
- **No hardcoded values** - use environment variables or config
- **Error handling** - always handle errors with descriptive messages
- **Input validation** - validate all user/external input

### Commit Messages

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

### Architecture Decisions

For significant architectural changes, please open an issue first to discuss the approach. See `docs/architecture.md` for the current system design.

## Project Structure

```
src/
  app/          # Next.js pages and API routes
  components/   # React components
  db/           # Database models and migrations
  hooks/        # React hooks
  lib/          # Core business logic
    anthropic/  # LLM integration
    voice/      # Voice validation pipeline
    slop/       # Slop detection system
    learning/   # Pattern learning
    generation/ # Content generation
    costs/      # Cost tracking
  types/        # TypeScript type definitions
  workers/      # Background job processors
workers/        # Python sidecar services
  langgraph/    # Content generation pipeline
  litellm/      # Multi-provider LLM gateway
  stylometry/   # Voice stylometric analysis
```

