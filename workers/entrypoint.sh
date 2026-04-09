#!/bin/bash
set -e

# Route to the appropriate worker based on WORKER_TYPE
case "$WORKER_TYPE" in
    "litellm")
        echo "Starting LiteLLM Gateway on port ${LITELLM_PORT:-8001}..."
        exec python /app/litellm/server.py
        ;;
    "langgraph")
        echo "Starting LangGraph Worker on port ${LANGGRAPH_WORKER_PORT:-8002}..."
        exec python /app/langgraph/server.py
        ;;
    "stylometry")
        echo "Starting Stylometry Worker on port ${STYLOMETRY_WORKER_PORT:-8003}..."
        exec python /app/stylometry/server.py
        ;;
    *)
        echo "Unknown WORKER_TYPE: $WORKER_TYPE"
        echo "Valid options: litellm, langgraph, stylometry"
        exit 1
        ;;
esac
