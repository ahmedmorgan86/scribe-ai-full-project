"""
Shared health check utilities for Python workers.

Provides standardized health check response format and common
dependency checking functions used across all worker services.
"""

import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel, Field


class DependencyStatus(BaseModel):
    """Status of an individual dependency."""

    name: str = Field(description="Dependency name")
    status: str = Field(description="Status: healthy | degraded | unavailable")
    latency_ms: int | None = Field(default=None, description="Response latency in ms")
    details: dict[str, Any] = Field(default_factory=dict, description="Additional details")


class HealthCheckResponse(BaseModel):
    """Standardized health check response for all workers."""

    service: str = Field(description="Service name")
    status: str = Field(description="Overall status: healthy | degraded | unavailable")
    version: str = Field(description="Service version")
    timestamp: str = Field(description="Health check timestamp (ISO format)")
    uptime_seconds: int = Field(description="Service uptime in seconds")
    dependencies: list[DependencyStatus] = Field(
        default_factory=list, description="Status of dependencies"
    )
    checks: dict[str, bool] = Field(
        default_factory=dict, description="Individual check results"
    )


@dataclass
class HealthChecker:
    """Health checker for a worker service."""

    service_name: str
    version: str
    start_time: datetime = field(default_factory=datetime.utcnow)

    async def check_http_dependency(
        self,
        name: str,
        url: str,
        timeout: float = 5.0,
        expected_status: int = 200,
    ) -> DependencyStatus:
        """Check HTTP dependency health."""
        start = datetime.utcnow()
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=timeout)
                latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)

                if response.status_code == expected_status:
                    return DependencyStatus(
                        name=name,
                        status="healthy",
                        latency_ms=latency_ms,
                        details={"status_code": response.status_code},
                    )
                else:
                    return DependencyStatus(
                        name=name,
                        status="degraded",
                        latency_ms=latency_ms,
                        details={
                            "status_code": response.status_code,
                            "expected": expected_status,
                        },
                    )
        except httpx.TimeoutException:
            latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
            return DependencyStatus(
                name=name,
                status="unavailable",
                latency_ms=latency_ms,
                details={"error": "timeout"},
            )
        except Exception as e:
            latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
            return DependencyStatus(
                name=name,
                status="unavailable",
                latency_ms=latency_ms,
                details={"error": str(e)},
            )

    def check_env_var(self, var_name: str) -> bool:
        """Check if environment variable is set and non-empty."""
        value = os.getenv(var_name)
        return bool(value and value.strip())

    def get_uptime_seconds(self) -> int:
        """Get service uptime in seconds."""
        return int((datetime.utcnow() - self.start_time).total_seconds())

    def build_response(
        self,
        dependencies: list[DependencyStatus],
        checks: dict[str, bool],
    ) -> HealthCheckResponse:
        """Build health check response with calculated overall status."""
        all_deps_healthy = all(d.status == "healthy" for d in dependencies)
        any_deps_unavailable = any(d.status == "unavailable" for d in dependencies)
        all_checks_pass = all(checks.values()) if checks else True

        if all_deps_healthy and all_checks_pass:
            status = "healthy"
        elif any_deps_unavailable:
            status = "unavailable"
        else:
            status = "degraded"

        return HealthCheckResponse(
            service=self.service_name,
            status=status,
            version=self.version,
            timestamp=datetime.utcnow().isoformat(),
            uptime_seconds=self.get_uptime_seconds(),
            dependencies=dependencies,
            checks=checks,
        )


async def check_qdrant_health(
    client: Any,
    name: str = "qdrant",
) -> DependencyStatus:
    """Check Qdrant vector database health."""
    start = datetime.utcnow()
    try:
        collections = client.get_collections()
        latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        return DependencyStatus(
            name=name,
            status="healthy",
            latency_ms=latency_ms,
            details={"collections_count": len(collections.collections)},
        )
    except Exception as e:
        latency_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        return DependencyStatus(
            name=name,
            status="unavailable",
            latency_ms=latency_ms,
            details={"error": str(e)},
        )
