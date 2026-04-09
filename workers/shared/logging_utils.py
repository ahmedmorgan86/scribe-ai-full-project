"""
Shared logging utilities for Python workers.

Provides consistent logging configuration across all worker services.
"""

import logging
import os


def setup_logger(name: str, level: str | None = None) -> logging.Logger:
    """
    Set up a logger with consistent formatting.

    Args:
        name: Logger name (typically module name)
        level: Log level (debug, info, warning, error). Defaults to LOG_LEVEL env var.

    Returns:
        Configured logger instance.
    """
    if level is None:
        level = os.getenv("LOG_LEVEL", "info")

    log_level = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger = logging.getLogger(name)
    logger.setLevel(log_level)

    return logger
