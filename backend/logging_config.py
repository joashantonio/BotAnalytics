"""
Central logging setup. Call configure_logging() once at app startup.

Level overridable via LOG_LEVEL env (default INFO). Logs go to stdout so the
container runtime / docker logs picks them up — no log files inside the
container layer.
"""
import logging
import os
import sys


def configure_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )

    root = logging.getLogger()
    # Avoid duplicate handlers if reconfigured (e.g. multiple workers re-import).
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        root.addHandler(handler)
    root.setLevel(level)

    # uvicorn already configures its own loggers; keep them but align level.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        logging.getLogger(name).setLevel(level)
