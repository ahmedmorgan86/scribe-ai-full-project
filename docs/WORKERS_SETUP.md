# Python Workers - Local Development Setup

This guide covers running Python workers for local development.

## Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────┐
│     Next.js App     │────▶│   Qdrant (6333)     │
│     (port 3000)     │     └─────────────────────┘
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│  LiteLLM Gateway    │────▶│  Anthropic/OpenAI   │
│     (port 8001)     │     │       APIs          │
└─────────────────────┘     └─────────────────────┘
          ▲
          │
┌─────────────────────┐     ┌─────────────────────┐
│  LangGraph Worker   │     │ Stylometry Worker   │
│     (port 8002)     │     │    (port 8003)      │
└─────────────────────┘     └─────────────────────┘
```

| Service | Port | Purpose |
|---------|------|---------|
| Qdrant | 6333 | Vector database for embeddings |
| LiteLLM Gateway | 8001 | Multi-provider LLM routing with fallback |
| LangGraph Worker | 8002 | Content generation pipeline |
| Stylometry Worker | 8003 | Voice stylometric analysis |

## Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for running workers without Docker)
- Node.js 18+ (for Next.js app)

## Quick Start (Docker)

**Recommended approach** - runs all services in containers.

```bash
# 1. Copy environment variables
cp .env.example .env.local

# 2. Edit .env.local with your API keys
#    Required: ANTHROPIC_API_KEY
#    Optional: OPENAI_API_KEY (for fallback)

# 3. Start all services
docker compose up -d

# 4. Check service health
docker compose ps

# 5. View logs
docker compose logs -f
```

Services will be available at:
- Qdrant: http://localhost:6333
- LiteLLM: http://localhost:8001/health
- LangGraph: http://localhost:8002/health
- Stylometry: http://localhost:8003/health

### Starting Specific Services

```bash
# Start only Qdrant
docker compose up -d qdrant

# Start Qdrant + LiteLLM
docker compose up -d qdrant litellm-gateway

# Start everything except stylometry
docker compose up -d qdrant litellm-gateway langgraph-worker
```

### Rebuilding After Code Changes

```bash
# Rebuild specific worker
docker compose build langgraph-worker
docker compose up -d langgraph-worker

# Rebuild all workers
docker compose build
docker compose up -d
```

## Manual Setup (Without Docker)

For development or debugging, run workers directly with Python.

### 1. Set Up Python Environment

```bash
cd workers

# Create virtual environment
python -m venv venv

# Activate (Linux/Mac)
source venv/bin/activate

# Activate (Windows)
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Start Qdrant

```bash
# Option A: Docker (recommended)
docker run -d -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:v1.12.5

# Option B: Use docker-compose.qdrant.yml
docker compose -f docker-compose.qdrant.yml up -d
```

### 3. Start Workers (Separate Terminals)

**Terminal 1 - LiteLLM Gateway:**
```bash
cd workers
source venv/bin/activate  # or .\venv\Scripts\activate on Windows

export ANTHROPIC_API_KEY=sk-ant-xxxxx
export OPENAI_API_KEY=sk-xxxxx  # optional
export LITELLM_PORT=8001

python litellm/server.py
```

**Terminal 2 - LangGraph Worker:**
```bash
cd workers
source venv/bin/activate

export ANTHROPIC_API_KEY=sk-ant-xxxxx
export OPENAI_API_KEY=sk-xxxxx
export QDRANT_URL=http://localhost:6333
export LITELLM_GATEWAY_URL=http://localhost:8001
export USE_LITELLM_GATEWAY=true
export LANGGRAPH_WORKER_PORT=8002
export NEXTJS_URL=http://localhost:3000

python langgraph/server.py
```

**Terminal 3 - Stylometry Worker:**
```bash
cd workers
source venv/bin/activate

export STYLOMETRY_WORKER_PORT=8003

python stylometry/server.py
```

### 4. Start Next.js App

```bash
# In project root (new terminal)
npm run dev
```

## Environment Variables

Required in `.env.local`:

```bash
# API Keys
ANTHROPIC_API_KEY=sk-ant-xxxxx     # Required
OPENAI_API_KEY=sk-xxxxx            # Optional, enables fallback

# Vector Database
QDRANT_URL=http://localhost:6333

# Workers
USE_LITELLM_GATEWAY=true
LITELLM_GATEWAY_URL=http://localhost:8001
LANGGRAPH_WORKER_URL=http://localhost:8002
STYLOMETRY_WORKER_URL=http://localhost:8003
```

## Health Checks

Verify all services are running:

```bash
# Qdrant
curl http://localhost:6333/readiness

# LiteLLM Gateway
curl http://localhost:8001/health

# LangGraph Worker
curl http://localhost:8002/health

# Stylometry Worker
curl http://localhost:8003/health
```

Or check from the Settings page in the UI (http://localhost:3000/settings).

## Troubleshooting

### Worker Won't Start

1. Check Python version: `python --version` (need 3.11+)
2. Check dependencies: `pip install -r requirements.txt`
3. Check port availability: `lsof -i :8001` (or `netstat -an | grep 8001` on Windows)

### LangGraph Can't Connect to Qdrant

1. Verify Qdrant is running: `curl http://localhost:6333/readiness`
2. Check QDRANT_URL environment variable
3. For Docker, use `http://qdrant:6333` (service name)

### LangGraph Can't Connect to LiteLLM

1. Verify LiteLLM is running: `curl http://localhost:8001/health`
2. Check USE_LITELLM_GATEWAY=true
3. For Docker, use `http://litellm-gateway:8001`

### API Key Errors

1. Verify key format: ANTHROPIC_API_KEY should start with `sk-ant-`
2. Check key permissions in provider console
3. Run `curl http://localhost:8001/health?deep=true` for detailed status

### Docker Network Issues

```bash
# Check network
docker network ls

# Inspect network
docker network inspect ai-social-engine_ai-social-engine

# Recreate network
docker compose down
docker compose up -d
```

## Development Workflow

### Iterating on Worker Code

1. Make changes to Python files in `workers/`
2. If using Docker:
   ```bash
   docker compose build langgraph-worker
   docker compose up -d langgraph-worker
   ```
3. If running manually, just restart the Python process

### Viewing Worker Logs

```bash
# Docker: All workers
docker compose logs -f

# Docker: Specific worker
docker compose logs -f langgraph-worker

# Manual: Logs appear in terminal
# Set LOG_LEVEL=debug for verbose output
```

### Testing Workers in Isolation

```bash
# Test LiteLLM completion
curl -X POST http://localhost:8001/completion \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'

# Test stylometry analysis
curl -X POST http://localhost:8003/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "This is a sample text for analysis."}'

# Test LangGraph generation (requires Qdrant + LiteLLM)
curl -X POST http://localhost:8002/generate \
  -H "Content-Type: application/json" \
  -d '{"sources": [{"content": "AI is transforming software development", "source_type": "tweet"}]}'
```

## Stopping Services

```bash
# Docker: Stop all
docker compose down

# Docker: Stop specific
docker compose stop langgraph-worker

# Docker: Remove volumes (data loss!)
docker compose down -v
```
