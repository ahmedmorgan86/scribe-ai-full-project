"""
State Checkpointing for LangGraph Pipeline

Provides persistent storage of graph execution states for debugging and recovery.
Uses SQLite for durability while supporting the LangGraph checkpoint interface.

Storage:
- checkpoints table: Stores serialized graph state at each node
- checkpoint_metadata table: Stores job info and timing
"""

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    SerializerProtocol,
)


class JsonSerializer:
    """Simple JSON serializer for checkpoint data."""

    def dumps(self, obj: Any) -> bytes:
        """Serialize object to JSON bytes."""
        return json.dumps(obj, default=str, ensure_ascii=False).encode("utf-8")

    def dumps_typed(self, obj: Any) -> tuple[str, bytes]:
        """Serialize with type hint."""
        return ("json", self.dumps(obj))

    def loads(self, data: bytes) -> Any:
        """Deserialize JSON bytes to object."""
        return json.loads(data.decode("utf-8"))

    def loads_typed(self, data: tuple[str, bytes]) -> Any:
        """Deserialize with type hint."""
        return self.loads(data[1])


class SQLiteCheckpointer(BaseCheckpointSaver):
    """
    SQLite-based checkpoint saver for LangGraph.

    Persists graph state to disk for debugging and recovery.
    Thread-safe with connection-per-thread pattern.
    """

    def __init__(self, db_path: str | None = None, serde: SerializerProtocol | None = None):
        """
        Initialize SQLite checkpointer.

        Args:
            db_path: Path to SQLite database. Defaults to DATA_DIR/langgraph_checkpoints.db
            serde: Serializer for checkpoint data. Defaults to JsonSerializer.
        """
        super().__init__(serde=serde or JsonSerializer())

        if db_path is None:
            data_dir = os.getenv("DATA_DIR", "./data")
            Path(data_dir).mkdir(parents=True, exist_ok=True)
            db_path = os.path.join(data_dir, "langgraph_checkpoints.db")

        self.db_path = db_path
        self._local = threading.local()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        """Get thread-local database connection."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def _init_db(self) -> None:
        """Initialize database schema."""
        conn = self._get_conn()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                type TEXT,
                checkpoint BLOB NOT NULL,
                metadata BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            );

            CREATE INDEX IF NOT EXISTS idx_checkpoints_thread
                ON checkpoints(thread_id, checkpoint_ns);

            CREATE INDEX IF NOT EXISTS idx_checkpoints_created
                ON checkpoints(created_at);

            CREATE TABLE IF NOT EXISTS checkpoint_writes (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                channel TEXT NOT NULL,
                type TEXT,
                value BLOB,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
            );

            CREATE TABLE IF NOT EXISTS job_metadata (
                job_id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                content_type TEXT,
                source_count INTEGER,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                final_status TEXT,
                error TEXT,
                FOREIGN KEY (thread_id) REFERENCES checkpoints(thread_id)
            );

            CREATE INDEX IF NOT EXISTS idx_job_metadata_thread
                ON job_metadata(thread_id);

            CREATE INDEX IF NOT EXISTS idx_job_metadata_status
                ON job_metadata(status);
            """
        )
        conn.commit()

    def put(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, int | str] | None = None,
    ) -> dict[str, Any]:
        """
        Store a checkpoint.

        Args:
            config: Configuration with thread_id and checkpoint_ns
            checkpoint: The checkpoint data to store
            metadata: Metadata about the checkpoint
            new_versions: Channel version mapping

        Returns:
            Updated configuration with checkpoint_id
        """
        conn = self._get_conn()

        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = checkpoint["id"]
        parent_id = config["configurable"].get("checkpoint_id")

        type_hint, serialized_checkpoint = self.serde.dumps_typed(checkpoint)
        _, serialized_metadata = self.serde.dumps_typed(metadata)

        conn.execute(
            """
            INSERT OR REPLACE INTO checkpoints
                (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                thread_id,
                checkpoint_ns,
                checkpoint_id,
                parent_id,
                type_hint,
                serialized_checkpoint,
                serialized_metadata,
            ),
        )
        conn.commit()

        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
            }
        }

    def put_writes(
        self,
        config: dict[str, Any],
        writes: list[tuple[str, Any]],
        task_id: str,
    ) -> None:
        """Store pending writes for a checkpoint."""
        conn = self._get_conn()

        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = config["configurable"]["checkpoint_id"]

        for idx, (channel, value) in enumerate(writes):
            type_hint, serialized_value = self.serde.dumps_typed(value)
            conn.execute(
                """
                INSERT OR REPLACE INTO checkpoint_writes
                    (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type_hint, serialized_value),
            )

        conn.commit()

    def get_tuple(self, config: dict[str, Any]) -> CheckpointTuple | None:
        """
        Get a specific checkpoint.

        Args:
            config: Configuration with thread_id and optional checkpoint_id

        Returns:
            CheckpointTuple or None if not found
        """
        conn = self._get_conn()

        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = config["configurable"].get("checkpoint_id")

        if checkpoint_id:
            row = conn.execute(
                """
                SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
                FROM checkpoints
                WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
                """,
                (thread_id, checkpoint_ns, checkpoint_id),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
                FROM checkpoints
                WHERE thread_id = ? AND checkpoint_ns = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (thread_id, checkpoint_ns),
            ).fetchone()

        if not row:
            return None

        checkpoint = self.serde.loads_typed((row["type"], row["checkpoint"]))
        metadata = self.serde.loads_typed((row["type"], row["metadata"])) if row["metadata"] else {}

        pending_writes: list[tuple[str, str, Any]] = []
        write_rows = conn.execute(
            """
            SELECT task_id, channel, type, value
            FROM checkpoint_writes
            WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
            ORDER BY idx
            """,
            (thread_id, checkpoint_ns, row["checkpoint_id"]),
        ).fetchall()

        for write_row in write_rows:
            value = self.serde.loads_typed((write_row["type"], write_row["value"]))
            pending_writes.append((write_row["task_id"], write_row["channel"], value))

        parent_config = None
        if row["parent_checkpoint_id"]:
            parent_config = {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": row["parent_checkpoint_id"],
                }
            }

        return CheckpointTuple(
            config={
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": row["checkpoint_id"],
                }
            },
            checkpoint=checkpoint,
            metadata=metadata,
            parent_config=parent_config,
            pending_writes=pending_writes,
        )

    def list(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        """
        List checkpoints for a thread.

        Args:
            config: Configuration with thread_id
            filter: Optional metadata filter
            before: Optional checkpoint to list before
            limit: Maximum number of checkpoints to return

        Yields:
            CheckpointTuple for each matching checkpoint
        """
        conn = self._get_conn()

        if not config:
            return

        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")

        query = """
            SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at
            FROM checkpoints
            WHERE thread_id = ? AND checkpoint_ns = ?
        """
        params: list[Any] = [thread_id, checkpoint_ns]

        if before:
            before_id = before["configurable"]["checkpoint_id"]
            query += " AND created_at < (SELECT created_at FROM checkpoints WHERE checkpoint_id = ?)"
            params.append(before_id)

        query += " ORDER BY created_at DESC"

        if limit:
            query += " LIMIT ?"
            params.append(limit)

        rows = conn.execute(query, params).fetchall()

        for row in rows:
            checkpoint = self.serde.loads_typed((row["type"], row["checkpoint"]))
            metadata = self.serde.loads_typed((row["type"], row["metadata"])) if row["metadata"] else {}

            parent_config = None
            if row["parent_checkpoint_id"]:
                parent_config = {
                    "configurable": {
                        "thread_id": thread_id,
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": row["parent_checkpoint_id"],
                    }
                }

            yield CheckpointTuple(
                config={
                    "configurable": {
                        "thread_id": thread_id,
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": row["checkpoint_id"],
                    }
                },
                checkpoint=checkpoint,
                metadata=metadata,
                parent_config=parent_config,
                pending_writes=[],
            )

    def save_job_metadata(
        self,
        job_id: str,
        thread_id: str,
        content_type: str,
        source_count: int,
    ) -> None:
        """Save metadata about a generation job."""
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO job_metadata (job_id, thread_id, content_type, source_count, started_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (job_id, thread_id, content_type, source_count, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()

    def complete_job(
        self,
        job_id: str,
        final_status: str,
        error: str | None = None,
    ) -> None:
        """Mark a job as complete."""
        conn = self._get_conn()
        conn.execute(
            """
            UPDATE job_metadata
            SET status = 'completed', completed_at = ?, final_status = ?, error = ?
            WHERE job_id = ?
            """,
            (datetime.now(timezone.utc).isoformat(), final_status, error, job_id),
        )
        conn.commit()

    def get_job_checkpoints(self, job_id: str) -> list[dict[str, Any]]:
        """
        Get all checkpoints for a job.

        Returns a list of checkpoint states ordered by creation time.
        """
        conn = self._get_conn()

        job_row = conn.execute(
            "SELECT thread_id FROM job_metadata WHERE job_id = ?",
            (job_id,),
        ).fetchone()

        if not job_row:
            return []

        thread_id = job_row["thread_id"]

        rows = conn.execute(
            """
            SELECT checkpoint_id, type, checkpoint, metadata, created_at
            FROM checkpoints
            WHERE thread_id = ?
            ORDER BY created_at ASC
            """,
            (thread_id,),
        ).fetchall()

        checkpoints = []
        for row in rows:
            checkpoint = self.serde.loads_typed((row["type"], row["checkpoint"]))
            metadata = self.serde.loads_typed((row["type"], row["metadata"])) if row["metadata"] else {}

            checkpoints.append(
                {
                    "checkpoint_id": row["checkpoint_id"],
                    "created_at": row["created_at"],
                    "state": checkpoint,
                    "metadata": metadata,
                }
            )

        return checkpoints

    def get_job_info(self, job_id: str) -> dict[str, Any] | None:
        """Get job metadata."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM job_metadata WHERE job_id = ?",
            (job_id,),
        ).fetchone()

        if not row:
            return None

        return dict(row)

    def cleanup_old_checkpoints(self, max_age_hours: int = 24) -> int:
        """
        Remove checkpoints older than max_age_hours.

        Returns the number of checkpoints deleted.
        """
        conn = self._get_conn()

        cutoff = datetime.now(timezone.utc).isoformat()

        cursor = conn.execute(
            """
            DELETE FROM checkpoints
            WHERE created_at < datetime(?, '-' || ? || ' hours')
            """,
            (cutoff, max_age_hours),
        )

        deleted = cursor.rowcount

        conn.execute(
            """
            DELETE FROM job_metadata
            WHERE started_at < datetime(?, '-' || ? || ' hours')
            """,
            (cutoff, max_age_hours),
        )

        conn.commit()

        return deleted


_checkpointer: SQLiteCheckpointer | None = None


def get_checkpointer() -> SQLiteCheckpointer:
    """Get singleton checkpointer instance."""
    global _checkpointer
    if _checkpointer is None:
        _checkpointer = SQLiteCheckpointer()
    return _checkpointer


def reset_checkpointer() -> None:
    """Reset checkpointer singleton (for testing)."""
    global _checkpointer
    _checkpointer = None
