# Python Workers Dockerfile
# Supports: litellm, langgraph, stylometry workers
# Build: docker build --build-arg WORKER_TYPE=langgraph -t ai-social-engine-langgraph .

FROM python:3.11-slim

# Worker type to build (litellm, langgraph, stylometry)
ARG WORKER_TYPE=litellm

# Labels for container identification
LABEL maintainer="ai-social-engine"
LABEL worker.type="${WORKER_TYPE}"

WORKDIR /app

# Install system dependencies
# - curl: for health checks
# - build-essential: for compiling Python packages with C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r worker && useradd -r -g worker worker

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy shared utilities first (available to all workers)
COPY shared/ ./shared/

# Copy worker-specific code based on WORKER_TYPE
COPY ${WORKER_TYPE}/ ./${WORKER_TYPE}/

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R worker:worker /app/data

# Set environment variables
ENV WORKER_TYPE=${WORKER_TYPE}
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app

# Entry point script that routes to the correct worker
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user
USER worker

# Default ports (override via docker-compose or -p flag)
# litellm: 8001, langgraph: 8002, stylometry: 8003
EXPOSE 8001 8002 8003

# Health check (endpoint available on all workers)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${LITELLM_PORT:-${LANGGRAPH_WORKER_PORT:-${STYLOMETRY_WORKER_PORT:-8001}}}/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
