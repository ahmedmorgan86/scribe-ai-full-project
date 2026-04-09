# LangGraph Evaluation: JavaScript vs Python Sidecar

**Date:** 2026-01-16
**Decision:** Python Sidecar (recommended by PRD)
**Status:** Evaluated

---

## Context

The ai-social-engine needs a cyclic content generation pipeline with:
- Nodes: analyze_source → select_formula → generate_draft → voice_check → slop_check → [critique → rewrite]* → finalize
- Max 3 rewrite cycles before rejection
- State checkpointing for debugging
- Integration with existing Qdrant + LiteLLM gateway

## Options Evaluated

### Option A: LangGraph.js (Pure TypeScript)

**Pros:**
- Single runtime (Node.js) - simpler deployment
- No IPC overhead between services
- Direct access to existing Qdrant client, LiteLLM gateway
- TypeScript end-to-end type safety
- Easier debugging (single process)

**Cons:**
- Less mature than Python version
- Fewer production examples and community resources
- Smaller ecosystem for ML/NLP utilities
- Python LangGraph gets features first

### Option B: Python Sidecar via HTTP (PRD Recommended)

**Pros:**
- Mature, battle-tested LangGraph Python
- Rich ecosystem (langchain, numpy, spacy for stylometry)
- More documentation and examples
- Better support for checkpointing (SQLite, Postgres backends)
- Aligns with Phase 25 (Stylometry) and Phase 26 (Python Workers) requirements
- Human-in-the-loop and subgraph features fully supported

**Cons:**
- Dual runtime complexity (Node.js + Python)
- HTTP IPC overhead on workflow calls
- Docker multi-container deployment
- Split logging and debugging
- Cold start latency for Python service

## Evaluation Criteria

| Criterion | LangGraph.js | Python Sidecar | Winner |
|-----------|--------------|----------------|--------|
| Feature completeness | Partial | Full | Python |
| Cyclic workflow support | Yes | Yes | Tie |
| State checkpointing | Limited | Multiple backends | Python |
| Ecosystem (NLP libs) | Limited | Extensive | Python |
| Deployment simplicity | Simple | Complex | JS |
| Runtime overhead | None | HTTP IPC | JS |
| Future extensibility (stylometry) | Manual impl | spacy/nltk | Python |
| Team familiarity | TypeScript | Mixed | Depends |

## Decision

**Python Sidecar via HTTP** (as recommended in PRD)

### Rationale

1. **Phase 25/26 Synergy**: The PRD already includes Python Workers infrastructure (Section 26) for stylometry. Using Python for LangGraph creates a unified Python worker architecture.

2. **Feature Requirements**: The generation pipeline needs:
   - Cyclic edges with iteration counting ✓ Both support
   - State checkpointing for debugging ✓ Python has mature backends
   - Conditional routing ✓ Both support
   - Max rewrite limits ✓ Both support

3. **Stylometry Integration**: Phase 25 requires NLP libraries (spacy, nltk) for stylometric analysis. Python sidecar enables natural integration.

4. **Production Maturity**: LangGraph Python has more production deployments and documentation for complex agentic workflows.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js Frontend                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Next.js API Routes                     │
│  /api/generate → calls Python worker                     │
│  /api/posts, /api/queue, etc. → existing SQLite/Qdrant  │
└─────────────────────────────────────────────────────────┘
                            │ HTTP
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Python Worker (FastAPI + LangGraph)         │
│                                                          │
│  POST /generate                                          │
│    → LangGraph workflow executes                         │
│    → Calls Qdrant (via HTTP) for voice check             │
│    → Returns generated content + reasoning               │
│                                                          │
│  POST /stylometry (future)                               │
│    → Stylometric analysis                                │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 Shared Infrastructure                    │
│  - Qdrant (vector search)                               │
│  - SQLite (posts, feedback, patterns)                   │
│  - LiteLLM Gateway (unified LLM access)                 │
└─────────────────────────────────────────────────────────┘
```

## Implementation Notes

1. **Worker Communication**: Use HTTP JSON API between Next.js and Python worker
2. **Shared Data**: Python worker can:
   - Query Qdrant directly (via REST API)
   - Use LiteLLM gateway for LLM calls
   - Not access SQLite directly (avoids locking issues)
3. **State Management**: Workflow state stays in Python; final results stored in SQLite via Next.js API
4. **Health Checks**: Python worker exposes /health endpoint for monitoring

## Next Steps

1. Create `/workers/langgraph/` directory structure
2. Create `requirements.txt` with langgraph, langchain-anthropic, langchain-openai
3. Create FastAPI wrapper `/workers/langgraph/server.py`
4. Implement content generation graph

---

*This evaluation is part of Phase 1.5 - Section 24 (LangGraph Generation Pipeline)*
