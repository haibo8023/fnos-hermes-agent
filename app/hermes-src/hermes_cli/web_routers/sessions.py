"""Session dashboard routes.

Three routers because global route order matters: ``list_router`` (GET
/api/sessions) mounts before the profiles ``sessions_router``, ``search_router``
right after it, ``manage_router`` (mutation/detail) much later.  web_server-owned
helpers are reached via the late-binding seam so monkeypatching keeps working.
"""

import asyncio
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Callable, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from hermes_cli.session_listing import subagent_listing_scope
from hermes_cli.web_deps import late
from hermes_cli.web_server_gateway import _strip_session_list_rows
from hermes_cli.web_server_sessions import _maybe_auto_archive_for_profile, _session_latest_descendant
from hermes_cli.web_models import (
    BulkDeleteSessions, SessionImport, SessionOwnerBackfill, SessionPrune, SessionRename)
from hermes_cli.web_routers._common import (
    CORRUPT_STORE_DETAIL, corrupt_store_as_status, log as _log, destructive_profile, http_failure,
)
from hermes_state import is_malformed_db_error
from hermes_state_errors import SessionActiveWriteGuardError, StateDbReplacedError, is_transient_sqlite_error
from hermes_state_health import STORAGE_CORRUPT, note_storage_error, storage_state

list_router = APIRouter()
search_router = APIRouter()
manage_router = APIRouter()

_cron_default_profile = late("_cron_default_profile", "hermes_cli.web_server_cron")
_cron_profile_home = late("_cron_profile_home", "hermes_cli.web_server_cron")
_open_session_db_for_profile = late("_open_session_db_for_profile", "hermes_cli.web_server_sessions")
_session_db_path_for_profile = late("_session_db_path_for_profile", "hermes_cli.web_server_sessions")

_NOT_FOUND = "Session not found"

# CRITICAL — every literal-path route on ``manage_router`` MUST be declared
# BEFORE the templated ``/api/sessions/{session_id}`` family. Starlette matches
# in registration order and ``{session_id}`` is unconstrained, so e.g.
# ``DELETE /api/sessions/empty`` would otherwise be taken as "the session with
# id 'empty'" (404, or worse, deleting the wrong row). Move the block as a unit.

# Stream-safe import: FastAPI otherwise buffers an arbitrarily large JSON body
# before SessionDB can enforce its own per-session and transaction limits.
_SESSION_IMPORT_MAX_BYTES = 25 * 1024 * 1024


async def _read_session_import_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > _SESSION_IMPORT_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Session import payload is too large")
        body.extend(chunk)
    return bytes(body)


# Prune filters forwarded to SessionDB; string filters map "" -> None.
_PRUNE_STR_FILTERS = (
    "source", "title_like", "end_reason", "cwd_prefix", "model_like", "provider",
    "user_id", "chat_id", "chat_type", "branch_like")
_PRUNE_NUM_FILTERS = (
    "min_messages", "max_messages", "min_tokens", "max_tokens", "min_cost", "max_cost",
    "min_tool_calls", "max_tool_calls")


_PRUNE_ROW_KEYS = ("id", "source", "title", "model", "started_at", "last_active", "message_count")


def _prune_sessions(body: SessionPrune):
    """Delete ended sessions matching filters (mirrors `hermes sessions prune`)."""
    from hermes_cli.config import get_hermes_home
    has_window = body.started_before is not None or body.started_after is not None
    if body.older_than_days is not None and body.older_than_days < 1 and not has_window:
        raise HTTPException(status_code=400, detail="older_than_days must be >= 1")
    # Mirror the CLI: the implicit 90-day cutoff only applies to a truly bare
    # prune. Any attribute filter suppresses it unless older_than_days was
    # explicitly sent.
    attr_filters_set = any(
        getattr(body, f) is not None for f in _PRUNE_STR_FILTERS + _PRUNE_NUM_FILTERS)
    effective_older_than = body.older_than_days
    if has_window or (attr_filters_set and "older_than_days" not in body.model_fields_set):
        effective_older_than = None
    profile_home = _cron_profile_home(body.profile)[1] if body.profile else get_hermes_home()
    db = _open_session_db_for_profile(body.profile, read_only=False)
    try:
        filters = {
            "older_than_days": effective_older_than, "started_before": body.started_before,
            "started_after": body.started_after,
            "archived": None if body.include_archived else False,
            **{f: (getattr(body, f) or None) for f in _PRUNE_STR_FILTERS},
            **{f: getattr(body, f) for f in _PRUNE_NUM_FILTERS}}
        skipped_open = db.count_open_prune_matches(**filters)
        if body.dry_run:
            # Same whole-lineage selection prune_sessions applies, so the preview lists what it deletes.
            rows = db.list_prune_candidates(**filters, whole_lineages=True)
            return {
                "ok": True,
                "removed": 0,
                "matched": len(rows),
                "skipped_open": skipped_open,
                # Rows are ordered by last activity, not creation time.
                "oldest_last_active": rows[0]["last_active"] if rows else None,
                "newest_last_active": rows[-1]["last_active"] if rows else None,
                "oldest_started_at": min(r["started_at"] for r in rows) if rows else None,
                "newest_started_at": max(r["started_at"] for r in rows) if rows else None,
                "sessions": [{k: r.get(k) for k in _PRUNE_ROW_KEYS} for r in rows]}
        sessions_dir = profile_home / "sessions"
        removed = db.prune_sessions(
            sessions_dir=sessions_dir if sessions_dir.exists() else None,
            exclude_active_write_guards=True, **filters)
        return {"ok": True, "removed": removed, "skipped_open": skipped_open}
    finally:
        db.close()


_ACTIVE_WINDOW_S = 300


def _csv(value: Optional[str]) -> list[str]:
    """Split a comma-separated query param into stripped, non-empty items."""
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def _is_active(row: dict, now: float) -> bool:
    return (
        row.get("ended_at") is None
        and (now - row.get("last_active", row.get("started_at", 0))) < _ACTIVE_WINDOW_S)


def _with_db(profile: Optional[str], fn: Callable, *, read_only: bool):
    """Open the profile's session DB, run ``fn(db)``, always close."""
    db = _open_session_db_for_profile(profile, read_only=read_only)
    try:
        return fn(db)
    finally:
        db.close()


def _serving_profile(profile: Optional[str]) -> str:
    """The profile name rows are stamped with: the requested one, else the
    serving process's own — so default-profile rows never circulate unowned."""
    return _cron_profile_home(profile)[0] if profile else _cron_default_profile()


def _resolve_session_id(db, session_id: str) -> Optional[str]:
    """Resolve *session_id*; a corrupt store (prefix scan raises "malformed") is
    reported as 503 with the actual problem instead of a misleading 404."""
    try:
        return db.resolve_session_id(session_id)
    except sqlite3.DatabaseError as exc:
        if not is_malformed_db_error(exc):
            raise
        _log.error("state.db is corrupt while resolving session %s: %s", session_id, exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Session store is corrupt (database disk image is malformed). "
                "Sessions cannot be read until it is repaired — run "
                "`hermes doctor` for diagnosis."),
        ) from exc
    except StateDbReplacedError:
        # RuntimeError family, not sqlite3: same 503 payload as the analytics reads (#110054).
        with corrupt_store_as_status(db.db_path):
            raise


# ── Script-only cron runs (no SessionDB row) ─────────────────────────────────
# A ``no_agent`` cron job writes no session at all: its run history is built from
# the output docs under ``<home>/cron/output/<job_id>/`` and the rows carry ids of
# the shape ``cron_output:<job_id>:<stem>`` (see web_routers/cron.py). The desktop
# reuses the session view for those rows, so a missing detail/messages answer used
# to 404 straight into the session panel and crash it ("sessions" failed to render).

_CRON_OUTPUT_ID_PREFIX = "cron_output:"
# Job ids and filename stems are used as path segments — keep them to a set that
# cannot climb out of the job's output directory.
_CRON_OUTPUT_SEGMENT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
_CRON_OUTPUT_EXEC_RE = re.compile(r":exec:(\d+)$")
_CRON_OUTPUT_MAX_CHARS = 200_000
_CRON_OUTPUT_PREVIEW_CHARS = 180


def _parse_cron_output_id(session_id: Optional[str]):
    """Split a run-history id into ``(job_id, kind, ref)``; None when it is not one.

    ``kind`` is ``doc`` (a stored ``.md`` output), ``exec`` (a ledger attempt whose
    doc is gone) or ``latest`` (metadata-only row). Job ids never contain a colon,
    so the trailing segment(s) are unambiguous. Anything that does not match the
    producer's shapes — including traversal attempts — is rejected here.
    """
    if not session_id or not session_id.startswith(_CRON_OUTPUT_ID_PREFIX):
        return None
    rest = session_id[len(_CRON_OUTPUT_ID_PREFIX):]
    if not rest:
        return None
    if rest.endswith(":latest"):
        job_id = rest[: -len(":latest")]
        if not _CRON_OUTPUT_SEGMENT_RE.fullmatch(job_id):
            return None
        return job_id, "latest", None
    match = _CRON_OUTPUT_EXEC_RE.search(rest)
    if match:
        job_id = rest[: match.start()]
        if not _CRON_OUTPUT_SEGMENT_RE.fullmatch(job_id):
            return None
        return job_id, "exec", int(match.group(1))
    if ":" not in rest:
        return None
    job_id, stem = rest.rsplit(":", 1)
    if not _CRON_OUTPUT_SEGMENT_RE.fullmatch(job_id) or not _CRON_OUTPUT_SEGMENT_RE.fullmatch(stem):
        return None
    return job_id, "doc", stem


def _cron_output_path(profile: Optional[str], job_id: str, stem: str) -> Optional[Path]:
    """The run's output doc, or None when the job home cannot be resolved."""
    from hermes_cli.web_routers.cron import _cron_output_runs_dir

    try:
        runs_dir = Path(_cron_output_runs_dir(profile, job_id))
    except Exception:
        return None
    return runs_dir / f"{stem}.md"


def _cron_output_text(path: Optional[Path]):
    """Read the output doc: ``(text, truncated)``; empty when unreadable."""
    if path is None:
        return "", False
    try:
        raw = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return "", False
    if len(raw) > _CRON_OUTPUT_MAX_CHARS:
        return raw[:_CRON_OUTPUT_MAX_CHARS], True
    return raw, False


def _cron_output_title(text: str, fallback: str) -> str:
    """First non-empty line of the report (heading markers stripped)."""
    for line in (text or "").splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped[:200]
    return fallback


def _cron_output_started_at(path: Optional[Path], fallback: Optional[float]) -> float:
    """Run epoch seconds, decoded the same way the run list decodes it."""
    if path is not None:
        from hermes_cli.web_routers.cron import _cron_output_run_timestamp

        stamp = _cron_output_run_timestamp(path)
        if stamp:
            return float(stamp)
        try:
            return float(path.stat().st_mtime)
        except OSError:
            pass
    return float(fallback or 0.0)


def _cron_output_job_meta(profile: Optional[str], job_id: str):
    """``(status_label, error)`` from the job record — best effort, never fatal."""
    try:
        from hermes_cli.web_routers.cron import _get_cron_job_sync

        job = _get_cron_job_sync(job_id, profile)
    except Exception:
        return "", ""
    if not isinstance(job, dict):
        return "", ""
    return (
        str(job.get("last_status") or "").strip().replace("_", " ").upper(),
        str(job.get("last_error") or "").strip())


def _cron_output_attempt_meta(profile: Optional[str], job_id: str, index: int):
    """``(finished_at, status_label, error)`` for ledger attempt *index*."""
    try:
        from hermes_cli.web_routers.cron import _owner_profile_executions

        attempts = _owner_profile_executions(job_id)
    except Exception:
        return None, "", ""
    if not (0 <= index < len(attempts)):
        return None, "", ""
    attempt = attempts[index]
    return (
        attempt.get("finished_at") or attempt.get("claimed_at"),
        str(attempt.get("status") or "").replace("_", " ").upper(),
        str(attempt.get("error") or "").strip())


def _cron_output_placeholder(job_id: str, kind: str, ref, status_label: str, error: str) -> str:
    """Report text for a run whose output doc is gone (pruned, or never written)."""
    lines = ["# Cron run (script-only)", "", f"**Job ID:** {job_id}"]
    if kind == "exec":
        lines.append(f"**Attempt:** #{ref} (no output doc on disk)")
    elif kind == "latest":
        lines.append("**Run:** latest (no output doc on disk)")
    if status_label:
        lines.append(f"**Status:** {status_label}")
    if error:
        lines.append(f"**Error:** {error}")
    return "\n".join(lines) + "\n"


def _cron_output_detail(profile: Optional[str], session_id: str) -> Optional[dict]:
    """Synthesise the session detail for a script-only cron run id.

    Returns None only when *session_id* is not a ``cron_output:`` id — i.e. the
    caller keeps owning real sessions. Every well-formed run id gets a renderable
    payload, including ``exec:``/``latest`` rows and a ``doc`` whose file was
    pruned between the list request and the click.
    """
    parsed = _parse_cron_output_id(session_id)
    if parsed is None:
        return None
    job_id, kind, ref = parsed

    path = _cron_output_path(profile, job_id, ref) if kind == "doc" else None
    if path is not None and not path.is_file():
        path = None
    text, truncated = _cron_output_text(path)

    status_label, error = _cron_output_job_meta(profile, job_id)
    attempt_at = None
    if kind == "exec":
        attempt_at, attempt_status, attempt_error = _cron_output_attempt_meta(profile, job_id, ref)
        status_label = attempt_status or status_label
        error = attempt_error or error

    started_at = _cron_output_started_at(path, attempt_at)
    fallback_title = f"{status_label} · Script-only run" if status_label else "Script-only run"
    title = _cron_output_title(text, fallback_title)
    if not text:
        text = _cron_output_placeholder(job_id, kind, ref, status_label, error)

    profile_name = _serving_profile(profile)
    preview = re.sub(r"\s+", " ", text).strip()[:_CRON_OUTPUT_PREVIEW_CHARS] or None
    return {
        "id": session_id,
        "session_id": session_id,
        "title": title,
        "source": "cron_output",
        "model": None,
        "cwd": None,
        "started_at": started_at,
        "last_active": started_at,
        "ended_at": started_at,
        "message_count": 1,
        "tool_call_count": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "preview": preview,
        "archived": False,
        "pinned": False,
        "is_active": False,
        "profile": profile_name,
        "is_default_profile": profile_name == "default",
        # The run's report verbatim: the session view renders it as the single
        # message returned by _cron_output_messages.
        "content": text,
        "cron_output": {
            "job_id": job_id,
            "kind": kind,
            "file": path.name if path is not None else None,
            "path": str(path) if path is not None else None,
            "status": status_label or None,
            "error": error or None,
            "content": text,
            "content_truncated": truncated,
        },
    }


def _cron_output_messages(profile: Optional[str], session_id: str) -> Optional[dict]:
    """Same payload shape as GET /api/sessions/{id}/messages, one synthetic message."""
    detail = _cron_output_detail(profile, session_id)
    if detail is None:
        return None
    return {
        "session_id": session_id,
        "profile": detail["profile"],
        "messages": [{
            "id": _CRON_OUTPUT_ROW_ID,
            "session_id": session_id,
            "role": "assistant",
            "content": detail["content"],
            "tool_calls": None,
            "tool_call_id": None,
            "tool_name": None,
            "timestamp": detail["started_at"],
            "token_count": None,
            "active": 1,
            "compacted": 0,
            "display_kind": None,
        }],
        "pagination": {"limit": 1, "offset": 0, "order": "oldest", "returned": 1},
    }


def _cron_output_page(page: dict, *, limit: Optional[int], offset: int, order: Optional[str]) -> dict:
    """Apply the caller's window/pagination echo to the single-message page."""
    messages = page["messages"]
    start = max(0, offset)
    size = 500 if limit is None else max(0, limit)
    window = messages[start:start + size] if start < len(messages) else []
    page["messages"] = window
    page["pagination"] = {
        "limit": size, "offset": offset,
        "order": order or ("latest" if limit is None else "oldest"),
        "returned": len(window)}
    return page


_CRON_OUTPUT_ROW_ID = 1


def _cron_output_timeline(profile: Optional[str], session_id: str, *, limit: int, after_row_id: int):
    """One synthetic prompt for the run's output, in the timeline's shape.

    The desktop opens a chat by reading its timeline first, so without this the run
    record 404s into the session panel and pops "resume failed".
    """
    detail = _cron_output_detail(profile, session_id)
    if detail is None:
        return None
    entries = []
    if after_row_id < _CRON_OUTPUT_ROW_ID:
        entries.append({
            "row_id": _CRON_OUTPUT_ROW_ID,
            "preview": (detail.get("title") or detail.get("preview") or "")[:200],
            "timestamp": detail["started_at"],
        })
    return {
        "session_id": session_id,
        "profile": detail["profile"],
        "entries": entries,
        "pagination": {"limit": limit, "after_row_id": after_row_id, "returned": len(entries),
                       "total": 1, "has_more": False, "next_cursor": None},
    }


def _cron_output_around(profile: Optional[str], session_id: str, row_id: int, *, limit: int):
    """Bounded page around the synthetic prompt; None when the id is not a run."""
    page = _cron_output_messages(profile, session_id)
    if page is None:
        return None
    if row_id != _CRON_OUTPUT_ROW_ID:
        return {}          # route turns this into 404 "Prompt not found", like a real store
    messages = page["messages"][:limit]
    return {
        "session_id": session_id,
        "profile": page["profile"],
        "messages": messages,
        "pagination": {"row_id": row_id, "limit": limit, "returned": len(messages),
                       "order": "oldest", "offset": 0, "total": 1,
                       "has_older": False, "has_newer": False},
    }


def _cron_output_export(profile: Optional[str], session_id: str):
    """Session + its single output message, so Export works on a run record."""
    detail = _cron_output_detail(profile, session_id)
    if detail is None:
        return None
    page = _cron_output_messages(profile, session_id) or {"messages": []}
    return {**detail, "messages": page["messages"]}



# ``le=100`` on limit: an unbounded limit lets one request drag every session
# row (plus correlated-subquery preview work) out of SQLite in a single hit.
@list_router.get("/api/sessions")
def get_sessions(
    limit: int = Query(20, ge=0, le=100), offset: int = Query(0, ge=0), min_messages: int = 0,
    archived: str = "exclude", order: str = "created", source: str | None = None, sources: str | None = None,
    exclude_sources: str | None = None, cwd_prefix: str | None = None, full: bool = False,
    profile: Optional[str] = None):
    """List sessions.

    ``order=recent`` sorts by latest activity across the compression chain, so
    a long-running chat stays on page one after it auto-compresses onto a fresh
    id.  Rows omit ``system_prompt`` / ``model_config`` unless ``full=1``.
    """
    if archived not in ("exclude", "only", "include"):
        raise HTTPException(
            status_code=400, detail="archived must be one of: exclude, only, include")
    if order not in ("created", "recent"):
        raise HTTPException(status_code=400, detail="order must be one of: created, recent")
    profile_name = _cron_profile_home(profile)[0] if profile else None
    try:
        # Auto-archive is the only write on this GET path: run it on its own
        # maintenance connection, then open the listing connection read-only.
        _maybe_auto_archive_for_profile(profile)
        db = _open_session_db_for_profile(profile, read_only=True)
        try:
            min_message_count = max(0, min_messages)
            archived_only = archived == "only"
            include_archived = archived == "include"
            # Source scoping: the desktop splits recents (exclude=cron) from
            # the cron-jobs section (source=cron) into two independent lists.
            source_list = _csv(sources)
            include_subagents, exclude_list = subagent_listing_scope(
                Path(db.db_path).parent, source=source or None, sources=source_list or None,
                exclude_sources=_csv(exclude_sources) or None)
            scope = dict(
                source=source or None, sources=source_list or None,
                exclude_sources=exclude_list or None, cwd_prefix=(cwd_prefix or None),
                min_message_count=min_message_count, include_archived=include_archived,
                archived_only=archived_only, include_subagents=include_subagents)
            sessions = db.list_sessions_rich(
                limit=limit,
                offset=offset,
                order_by_last_active=order == "recent",
                # Skip the system_prompt blob inside SQLite too (pairs with
                # _strip_session_list_rows below).
                compact_rows=not full,
                include_pinned=True,
                **scope)
            total = db.session_count(exclude_children=True, **scope)
            now = time.time()
            row_profile = profile_name or _cron_default_profile()
            for s in sessions:
                s["is_active"] = _is_active(s, now)
                s["profile"] = row_profile
                s["is_default_profile"] = row_profile == "default"
                # SQLite stores the flags as 0/1; expose real JSON booleans.
                s["archived"] = bool(s.get("archived"))
                s["pinned"] = bool(s.get("pinned"))
            if not full:
                _strip_session_list_rows(sessions)
            # ``storage`` tells an empty page apart from an unreadable store (#72046); same
            # ``{profile: "corrupt"}`` shape as the /api/profiles/sessions* lists.
            storage = {row_profile: STORAGE_CORRUPT} if storage_state(db.db_path) == STORAGE_CORRUPT else {}
            return {"sessions": sessions, "total": total, "limit": limit, "offset": offset,
                    "storage": storage}
        finally:
            db.close()
    except HTTPException:
        raise
    except sqlite3.OperationalError as exc:
        _log.exception("GET /api/sessions failed")
        # 503, not 500: the store is busy, not gone — the desktop keeps its
        # sidebar instead of reading a 500 as an authoritative empty list.
        transient = is_transient_sqlite_error(exc)
        raise HTTPException(
            status_code=503 if transient else 500,
            detail=(
                "Session store is busy (disk I/O or lock). Retry; the list was not cleared."
                if transient
                else "Internal server error"),
        ) from exc
    except sqlite3.DatabaseError as exc:
        # A damaged store is unavailable, not empty and not an internal error (#72046).
        db_path = _session_db_path_for_profile(profile)
        if not (note_storage_error(db_path, exc) or is_malformed_db_error(exc)):
            _log.exception("GET /api/sessions failed")
            raise HTTPException(status_code=500, detail="Internal server error") from exc
        _log.error("GET /api/sessions: state.db at %s is corrupt: %s", db_path, exc)
        raise HTTPException(status_code=503, detail=dict(CORRUPT_STORE_DETAIL)) from exc
    except StateDbReplacedError:
        # RuntimeError family, not sqlite3: same 503 payload as the analytics reads (#110054).
        with corrupt_store_as_status(_session_db_path_for_profile(profile)):
            raise
    except Exception:
        _log.exception("GET /api/sessions failed")
        raise HTTPException(status_code=500, detail="Internal server error")


def _is_compression_edge(child: dict, parent: dict) -> bool:
    parent_ended_at = parent.get("ended_at")
    started_at = child.get("started_at")
    return (
        parent.get("end_reason") == "compression"
        and parent_ended_at is not None
        and started_at is not None
        and started_at >= parent_ended_at)


@search_router.get("/api/sessions/search")
async def search_sessions(
    q: str = "", limit: int = 20, profile: Optional[str] = None, source: str | None = None,
    sources: str | None = None, exclude_sources: str | None = None):
    """Search sessions by ID (first) plus FTS5 message content.

    Results are deduped by compression lineage, not raw ``session_id``:
    auto-compression rotates a chat onto a fresh id and leaves the old segment
    in the FTS index.  Branches also use ``parent_session_id`` but are real
    alternate conversations — they are NOT collapsed into the parent.
    """
    if not q or not q.strip():
        return {"results": []}
    with http_failure("GET /api/sessions/search failed", 500, detail="Search failed"):
        row_profile = _serving_profile(profile)

        def _search(db):
            safe_limit = max(1, min(int(limit or 20), 100))
            source_filter = source or None
            source_list = _csv(sources)
            include_sources = [source_filter] if source_filter else (source_list or None)
            exclude_list = _csv(exclude_sources)
            now = time.time()

            def get_session(sid):
                try:
                    return db.get_session(sid)
                except Exception:
                    return None

            # Walk parent_session_id to the compression root, memoized per
            # chain; stops at branch/delegate edges (those stay searchable).
            root_cache: dict = {}

            def compression_root(session_id: str) -> str:
                chain, cur, root = [], session_id, session_id
                while cur and cur not in chain:  # ``not in chain`` guards parent cycles
                    if cur in root_cache:
                        root = root_cache[cur]
                        break
                    chain.append(cur)
                    s = get_session(cur)
                    parent = s.get("parent_session_id") if isinstance(s, dict) else None
                    parent_session = get_session(parent) if parent else None
                    if not parent_session or not _is_compression_edge(s, parent_session):
                        root = cur
                        break
                    cur = parent
                for node in chain:
                    root_cache[node] = root
                return root

            tip_cache: dict = {}

            def lineage_tip(session_id: str) -> str:
                # Resolve the tip from the MATCHED id, never from the lineage
                # root: the forward chain walk is defensively bounded, so a
                # lineage deeper than the bound truncates to a stale mid id
                # when started at the root. Resuming from the matched id is
                # what the CLI does and always reaches the live tip (#125041).
                if session_id not in tip_cache:
                    try:
                        tip_cache[session_id] = db.get_compression_tip(session_id) or session_id
                    except Exception:
                        tip_cache[session_id] = session_id
                return tip_cache[session_id]

            # One keyspace for id-hits and content-hits, keyed by lineage root;
            # first hit wins, and ID matches run first.
            seen: dict = {}

            def add_lineage_result(raw_sid: str, payload: dict) -> None:
                if not raw_sid:
                    return
                root = compression_root(raw_sid)
                if root in seen or len(seen) >= safe_limit:
                    return
                payload = dict(payload)
                sid = lineage_tip(raw_sid)
                payload["session_id"] = sid
                payload["lineage_root"] = root
                payload["profile"] = row_profile
                payload["is_default_profile"] = row_profile == "default"
                try:
                    row = db.get_session_rich_row(sid)
                except Exception:
                    row = None
                if row:
                    last_active = row.get("last_active") or row.get("started_at")
                    payload.update({
                        "id": row.get("id") or sid,
                        "source": row.get("source"),
                        "model": row.get("model"),
                        "title": row.get("title"),
                        "started_at": row.get("started_at"),
                        "ended_at": row.get("ended_at"),
                        "last_active": last_active,
                        "is_active": (
                            row.get("ended_at") is None and (now - (last_active or 0)) < 300),
                        "message_count": row.get("message_count") or 0,
                        "tool_call_count": row.get("tool_call_count") or 0,
                        "input_tokens": row.get("input_tokens") or 0,
                        "output_tokens": row.get("output_tokens") or 0,
                        "preview": row.get("preview"),
                        "parent_session_id": row.get("parent_session_id"),
                        "profile": _serving_profile(profile),
                        "archived": bool(row.get("archived"))})
                else:
                    payload["id"] = sid
                seen[root] = payload

            def hit_payload(row: dict, snippet: str, role, session_started) -> dict:
                # `last_active` rides only on id-match rows (sessions table); FTS
                # hits have no row recency and leave it null so the desktop can
                # fall back to session_started instead of inventing one.
                return {
                    "snippet": snippet, "role": role, "source": row.get("source"),
                    "model": row.get("model"), "session_started": session_started,
                    "last_active": row.get("last_active")}

            # Direct ID matches first (pasted ids never appear in message text).
            for row in db.search_sessions_by_id(
                q, limit=safe_limit, include_archived=True, source=source_filter,
                sources=source_list or None, exclude_sources=exclude_list or None):
                sid = row.get("id")
                preview = (row.get("preview") or "").strip()
                snippet = preview or f"Session ID: {sid}"
                add_lineage_result(sid, hit_payload(row, snippet, None, row.get("started_at")))

            # Prefix wildcards so partial words match ("nimb" -> "nimb*");
            # quoted phrases and existing wildcards are kept as-is.
            prefix_query = " ".join(
                tok if tok.startswith('"') or tok.endswith("*") else tok + "*"
                for tok in re.findall(r'"[^"]*"|\S+', q.strip()))
            # Over-fetch so lineage dedup can still surface `limit` distinct
            # conversations when several hits collapse onto one root.
            matches = db.search_messages(
                query=prefix_query, source_filter=include_sources,
                exclude_sources=exclude_list or None, limit=max(safe_limit * 5, 50),
                fields=("session_id", "role", "snippet", "source", "model", "session_started"))
            for m in matches:
                if len(seen) >= safe_limit:
                    break
                add_lineage_result(
                    m["session_id"],
                    hit_payload(m, m.get("snippet", ""), m.get("role"), m.get("session_started")))

            # Title matches fill any remaining slots (#66242): the FTS index
            # only covers message content, so a term that lives solely in a
            # manually-set sessions.title would otherwise return nothing. The
            # DB layer already knows how to LIKE-match titles across the whole
            # compression chain (list_sessions_rich(search_query=) — the same
            # helper the sidebar listing uses), so reuse it rather than adding
            # a second title query path here. Best-effort: an old/odd store
            # that rejects the call just skips the lane.
            if len(seen) < safe_limit:
                try:
                    title_rows = db.list_sessions_rich(
                        search_query=q.strip(), include_archived=True, order_by_last_active=True,
                        source=source_filter, sources=source_list or None,
                        exclude_sources=exclude_list or None, limit=safe_limit)
                except Exception:  # health: allow BLE001 -- best-effort supplement lane: an old/odd store that rejects the search_query read must not fail the id+content results already collected
                    _log.debug("Title-match supplement skipped for %r", q[: 200])
                    title_rows = []
                for row in title_rows:
                    if len(seen) >= safe_limit:
                        break
                    sid = row.get("id")
                    if not sid:
                        continue
                    preview = (row.get("preview") or "").strip()
                    add_lineage_result(
                        sid, hit_payload(row, preview or f"Session title matched: {q.strip()}",
                                         None, row.get("started_at")))
            return {"results": list(seen.values())}

        # FTS over a large state.db is the slowest read here; keep it off the loop (#60747).
        return await asyncio.to_thread(_with_db, profile, _search, read_only=True)


@manage_router.post("/api/sessions/bulk-delete")
async def bulk_delete_sessions_endpoint(body: BulkDeleteSessions):
    """Delete every session in ``body.ids`` in one transaction (POST: many
    clients refuse a DELETE body).

    Per :meth:`SessionDB.delete_sessions`: unknown ids are skipped (``deleted``
    reports what really happened), children are orphaned, active/archived rows
    ARE deleted (hand-picked), on-disk cleanup is left to the next prune.

    Compression chains are deleted whole: the sessions list shows one row per
    logical conversation carrying the chain *tip's* id, so deleting only that
    row would leave the root to resurface as the previous chain link on the
    next reload (#57543). ``deleted`` still counts the selected rows, not the
    expanded chain links.
    """
    # Hard cap so a runaway selection can't lock the writer for long.
    if len(body.ids) > 500:
        raise HTTPException(status_code=400, detail="ids must contain at most 500 entries")
    profile = destructive_profile(body.profile, "POST /api/sessions/bulk-delete")
    skipped: list[str] = []  # rows a live turn/compression still owns; the UI must keep them listed
    deleted = await asyncio.to_thread(_with_db, profile, lambda db: db.delete_sessions(
        body.ids, exclude_active_write_guards=True, skipped_ids=skipped,
        include_compression_chain=True), read_only=False)
    return {"ok": True, "deleted": deleted, "skipped_active": skipped}


@manage_router.post("/api/sessions/import")
async def import_sessions_endpoint(request: Request):
    """Import sessions exported from the dashboard or CLI (session rows only —
    ``/api/ops/import`` restores a whole backup archive)."""
    try:
        raw_body = await _read_session_import_body(request)
        body = SessionImport.model_validate_json(raw_body)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid session import payload") from exc

    try:
        result = await asyncio.to_thread(
            _with_db, body.profile, lambda db: db.import_sessions(body.sessions), read_only=False)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not result.get("ok", False):
        raise HTTPException(status_code=400, detail=result)
    return result


@manage_router.get("/api/sessions/empty/count")
async def count_empty_sessions_endpoint(profile: Optional[str] = None):
    """Count of empty, ended, non-archived sessions (the "Delete empty (N)" button)."""
    count = await asyncio.to_thread(
        _with_db, profile, lambda db: db.count_empty_sessions(), read_only=True)
    return {"count": count}


@manage_router.delete("/api/sessions/empty")
async def delete_empty_sessions_endpoint(profile: Optional[str] = None):
    """Delete every empty, ended, non-archived session in one transaction.

    "Empty" means NO ``messages`` rows at all — a rewound/compacted chat reads
    ``message_count == 0`` while its soft-archived rows are the only transcript
    copy (see :meth:`SessionDB.delete_empty_sessions`).

    * Active sessions are skipped (``ended_at IS NULL``) so a live agent isn't yanked mid-handshake. *
    Archived sessions are skipped — the user explicitly chose to keep those rows. * Children of deleted
    parents are orphaned, not cascade-deleted. See #95868.
    """
    profile = destructive_profile(profile, "DELETE /api/sessions/empty")
    deleted = await asyncio.to_thread(
        _with_db, profile,
        lambda db: db.delete_empty_sessions(sessions_dir=_session_files_dir(profile)), read_only=False)
    return {"ok": True, "deleted": deleted}


@manage_router.get("/api/sessions/stats")
async def get_session_stats(profile: Optional[str] = None):
    """Session-store statistics (mirrors `hermes sessions stats`)."""
    def _stats(db):
        out = {
            # exclude_children=True: the dashboard Sessions page pairs these counts with
            # list_sessions_rich rows, which collapse compression chains to one row carrying
            # the tip's id — the raw row count is inflated by the hidden chain links (#54298).
            "total": db.session_count(include_archived=True, exclude_children=True),
            "active_store": db.session_count(include_archived=False, exclude_children=True),
            "archived": db.session_count(archived_only=True, exclude_children=True), "messages": db.message_count(),
            "by_source": {}}
        try:
            out["by_source"] = db.session_count_by_source(
                include_archived=True, exclude_children=True)
        except Exception:
            pass
        return out

    return await asyncio.to_thread(_with_db, profile, _stats, read_only=True)


@manage_router.get("/api/sessions/{session_id}")
async def get_session_detail(session_id: str, profile: Optional[str] = None):
    # Script-only cron runs are not in SessionDB: answer from the run's output
    # doc instead of 404-ing the desktop into a crashed session panel.
    cron_run = await asyncio.to_thread(_cron_output_detail, profile, session_id)
    if cron_run is not None:
        return cron_run

    def _detail(db):
        sid = _resolve_session_id(db, session_id)
        session = db.get_session(sid) if sid else None
        if not session:
            raise HTTPException(status_code=404, detail=_NOT_FOUND)
        # Always stamp the owner: unowned default-profile rows made multi-profile
        # clients resolve them to whichever gateway happened to be active.
        session["profile"] = _serving_profile(profile)
        session["is_default_profile"] = session["profile"] == "default"
        # A cron run's liveness is scheduler ownership, not the 300s activity
        # window (#88443): a run inside a long tool call is still owned.
        from hermes_cli.web_routers.cron import cron_run_scheduler_owned

        owned = cron_run_scheduler_owned(session, profile)
        if owned is not None:
            session["scheduler_owned"] = owned
        return session

    return await asyncio.to_thread(_with_db, profile, _detail, read_only=True)


@manage_router.get("/api/sessions/{session_id}/latest-descendant")
async def get_session_latest_descendant(session_id: str, profile: Optional[str] = None):
    if _parse_cron_output_id(session_id) is not None:
        # A run record has no compression lineage; answer from itself so the
        # desktop's "follow the newest segment" prefetch cannot 404 the panel.
        return {"requested_session_id": session_id, "session_id": session_id,
                "path": [session_id], "changed": False}

    latest, path = await asyncio.to_thread(
        _with_db, profile, lambda db: _session_latest_descendant(session_id, db), read_only=True)
    if not latest:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return {
        "requested_session_id": path[0] if path else session_id, "session_id": latest, "path": path,
        "changed": bool(path and latest != path[0])}


def _stored_tool_call_labels(message: dict) -> dict:
    from agent.display import tool_labels_for_call
    from tools.tool_labels import BRIDGE_TOOL_NAMES

    out = {}
    for call in message.get("tool_calls") or ():
        if not isinstance(call, dict):
            continue
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        call_id, name = str(call.get("id") or ""), str(fn.get("name") or "")
        if not call_id or name not in BRIDGE_TOOL_NAMES:
            continue
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except (TypeError, ValueError):
            args = {}
        labels = [label.as_payload() for label in tool_labels_for_call(name, args if isinstance(args, dict) else {})]
        if labels:
            out[call_id] = labels
    return out


def _with_tool_call_labels(message: dict) -> dict:
    labels = _stored_tool_call_labels(message)
    return {**message, "tool_call_labels": labels} if labels else message


def _history_profile_home(profile):
    if profile:
        return _cron_profile_home(profile)[1]
    # An omitted profile reads this process's DB (including custom HERMES_HOME),
    # not necessarily the registered default profile used by cron routes.
    from hermes_cli.config import get_hermes_home

    return get_hermes_home()


def _session_files_dir(profile) -> Path:
    """Transcript dir of the profile whose store a delete targets: ``SessionDB.delete_session`` only
    unlinks the session's on-disk artifacts when handed this, and a row-only delete leaves the
    (secret-bearing) ``session_<id>.json`` snapshots and ``request_dump_<id>_*.json`` readable after
    the user removed the session (#55088, #60207)."""
    return _history_profile_home(profile) / "sessions"


def _is_untyped_scaffold_notice(message) -> bool:
    """A ``[System: …]`` role=user row persisted without a ``display_kind``.

    ``[System:`` is a reserved gateway-notice namespace — it must never render as a user
    bubble (the gateway's own history projection drops these rows outright) — but recovery
    scaffolding written before typing existed carries no kind. Rows WITH a kind
    (``model_switch``, …) are timeline entries and keep flowing.
    """
    if not isinstance(message, dict) or message.get("role") != "user" or message.get("display_kind"):
        return False
    content = message.get("content")
    return isinstance(content, str) and content.lstrip().startswith("[System:")


def _project_for_display(messages: list, *, home=None, inline_images: bool = True) -> list:
    """Replace compaction summaries with their display-only projection and hide untyped
    gateway-scaffold notices.

    Recovery scaffolding (e.g. the stream-timeout nudge appended when a tool call's stream
    is cut) persists as a ``[System: …]`` ``role=user`` row with no ``display_kind``. This
    projection feeds the Desktop's transcript prefetch, which addresses VISIBLE user rows by
    durable row id — and the gateway truncation resolver refuses scaffold rows fail-closed,
    so a shipped scaffold row can never resolve as a rewind/regenerate target and dead-ends
    every retry (``refusing truncation without fallback``). Hide them the same way the
    Desktop collapses other display-only rows; typed notices stay for the timeline.
    """
    from agent.compaction_display import project_compaction_message_for_display
    from agent.context_compressor import is_compaction_summary_message
    from agent.conversation_compression import _extract_steer_text_from_message
    from agent.history_commentary import project_history_commentary
    from agent.prompt_builder import STEER_DISPLAY_KIND
    from agent.turn_failure_copy import untyped_failed_turn_display_kind

    # inline_images=False (#116511): render content through the gateway's ``_coerce_message_text``
    # projection so a data-URI image part becomes ``[image]`` — the same branch session.resume's
    # ``inline_images=false`` uses, kilobytes instead of re-transmitting every stored attachment.
    coerce = None
    if not inline_images:
        from tui_gateway.session_history import _coerce_message_text

        def coerce(message: dict) -> dict:
            if message.get("content") is not None:
                return {**message, "content": _coerce_message_text(message["content"], image_urls=False)}
            return message

    projected_messages = []
    for message in messages:
        message = _with_tool_call_labels(message)
        if coerce is not None:
            message = coerce(message)
        # Same read-side typing as session.resume (tui_gateway/session_history.py).
        failed_turn = not message.get("display_kind") and untyped_failed_turn_display_kind(
            message.get("role"), message.get("content"))
        if failed_turn:
            message = {**message, "display_kind": failed_turn}
        if _is_untyped_scaffold_notice(message):
            projected = message.copy()
            projected["display_kind"] = "hidden"
            projected_messages.append(projected)
            continue
        # Mid-turn steer: the user's own words, not the model-facing marker (same as session.resume).
        if message.get("role") == "user" and message.get("display_kind") == STEER_DISPLAY_KIND and (
                steer_text := _extract_steer_text_from_message(message)):
            message = {**message, "display_content": steer_text}
        if not is_compaction_summary_message(message):
            projected_messages.append(message)
            continue
        display_view = project_compaction_message_for_display(message)
        projected = message.copy()
        if display_view is None:
            if not projected.get("display_kind"):
                projected["display_kind"] = "hidden"
        else:
            # Keep the physical content for inspection/export compatibility;
            # Desktop consumes this display-only projection. A legacy hidden
            # wrapper must not hide a successfully recovered live ask.
            projected["display_content"] = display_view.get("content")
            projected.pop("display_kind", None)
        projected_messages.append(projected)
    return project_history_commentary(projected_messages, home=home)


@manage_router.get("/api/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str, profile: Optional[str] = None, limit: Optional[int] = Query(None, ge=0),
    offset: int = Query(0, ge=0), order: Optional[str] = Query(None),
    include_compacted: bool = Query(False), inline_images: bool = Query(True)):
    if order not in (None, "oldest", "latest"):
        raise HTTPException(status_code=400, detail="order must be one of: oldest, latest")

    cron_page = await asyncio.to_thread(_cron_output_messages, profile, session_id)
    if cron_page is not None:
        return _cron_output_page(cron_page, limit=limit, offset=offset, order=order)

    def _read(db):
        sid = _resolve_session_id(db, session_id)
        if not sid:
            return None
        sid = db.resolve_resume_session_id(sid)
        # Always page (an omitted limit used to load whole transcripts). Explicit
        # pagination anchors at the start; the default view is the latest page.
        default_page = limit is None
        latest_page = order == "latest" or (order is None and default_page)
        _limit = 500 if default_page else min(limit, 500)
        # Include compression-ancestor messages so the REST transcript
        # matches the gateway's session.resume (which uses
        # include_ancestors=True). Without this, the desktop's REST
        # prefetch only shows the child continuation's messages after a
        # compression rotation, hiding the pre-compaction transcript
        # (#51058).
        return sid, _limit, db.get_messages(
            sid, limit=_limit, offset=offset, latest=latest_page,
            include_compacted=include_compacted, include_ancestors=True)

    result = await asyncio.to_thread(_with_db, profile, _read, read_only=True)
    if result is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    sid, _limit, messages = result
    projected_messages = await asyncio.to_thread(
        _project_for_display, messages, home=_history_profile_home(profile),
        inline_images=inline_images)
    return {
        "session_id": sid,
        # The same stamp list rows carry, so the Desktop keys a page under the
        # owner it already routes the session by.
        "profile": _serving_profile(profile),
        "messages": projected_messages,
        "pagination": {
            "limit": _limit, "offset": offset,
            "order": order or ("latest" if limit is None else "oldest"),
            "returned": len(projected_messages)}}


def _timeline_session_id(db, session_id: str, owner: str) -> str:
    # Durable jump addresses are exact ids, never title/prefix guesses. A NULL
    # legacy owner belongs to this profile's store, just like /messages pages.
    def owned(sid):
        row = db._read_one("SELECT profile_name FROM sessions WHERE id = ?", (sid,))
        return row is not None and row["profile_name"] in (None, owner)

    if not owned(session_id):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    sid = db.resolve_resume_session_id(session_id)
    if not owned(sid):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return sid


@manage_router.get("/api/sessions/{session_id}/timeline")
async def get_session_timeline(
    session_id: str, profile: Optional[str] = None,
    limit: int = Query(500, ge=1, le=500), after_row_id: int = Query(0, ge=0),
):
    """Prompt metadata only, including compacted display history (never rewind rows).

    ``next_cursor`` is a stable logical first-row id; pass it as ``after_row_id``.
    Entry ``row_id`` addresses the current representative for /messages/around.
    """
    from hermes_state_timeline import get_session_timeline as read_timeline

    cron_timeline = await asyncio.to_thread(
        _cron_output_timeline, profile, session_id, limit=limit, after_row_id=after_row_id)
    if cron_timeline is not None:
        return cron_timeline

    owner = _serving_profile(profile)

    def _read(db):
        sid = _timeline_session_id(db, session_id, owner)
        return {"session_id": sid, "profile": owner,
                **read_timeline(db, sid, limit=limit, after_row_id=after_row_id)}

    return await asyncio.to_thread(_with_db, profile, _read, read_only=True)


@manage_router.get("/api/sessions/{session_id}/messages/around")
async def get_session_messages_around(
    session_id: str, row_id: int = Query(..., ge=1), profile: Optional[str] = None,
    limit: int = Query(120, ge=1, le=120),
):
    """Bounded display page starting at a timeline prompt; no intervening payloads."""
    from hermes_state_timeline import get_session_messages_around as read_around

    cron_around = await asyncio.to_thread(
        _cron_output_around, profile, session_id, row_id, limit=limit)
    if cron_around is not None:
        if not cron_around:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return cron_around

    owner = _serving_profile(profile)

    def _read(db):
        sid = _timeline_session_id(db, session_id, owner)
        page = read_around(db, sid, row_id, limit=limit)
        if page is None:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {"session_id": sid, "profile": owner, **page}

    result = await asyncio.to_thread(_with_db, profile, _read, read_only=True)
    result["messages"] = await asyncio.to_thread(
        _project_for_display, result["messages"], home=_history_profile_home(profile))
    return result


@manage_router.delete("/api/sessions/{session_id}")
async def delete_session_endpoint(session_id: str, profile: Optional[str] = None):
    def _delete(db):
        # Already-absent is an idempotent success: the desktop optimistically
        # removes the row and RESTORES it on any error, so a 404 resurrected
        # ghost rows (transient empties racing the sidebar snapshot).
        sid = _resolve_session_id(db, session_id)
        if not sid:
            return {"ok": True, "already_absent": True}
        try:
            # Chain-aware like bulk-delete: the list row the user clicked represents the
            # whole compression chain (and carries the tip's id), so deleting just this
            # physical row would resurface the conversation as the previous chain link
            # on reload (#57543).
            db.delete_session(sid, sessions_dir=_session_files_dir(profile),
                              exclude_active_write_guards=True, include_compression_chain=True)
        except SessionActiveWriteGuardError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        return {"ok": True}

    return await asyncio.to_thread(_with_db, profile, _delete, read_only=False)


@manage_router.post("/api/sessions/owner-backfill")
async def backfill_session_owner_profiles(body: SessionOwnerBackfill):
    """Stamp legacy ``profile_name = NULL`` rows with the serving-profile identity.

    A multi-connection Desktop fails closed on unowned rows.  Each ``state.db``
    belongs to exactly one profile, so this is a single-match, idempotent
    backfill (non-NULL owners are never overwritten).

    That was fine while one backend served everything, but a Desktop with registry topology (≥2 registered
    connections) fails closed on unowned rows by design — leaving every pre-campaign session unresumable
    with no migration path. Each profile's ``state.db`` belongs to exactly one profile, so stamping that
    store's own name is a single-match backfill, never a guess; the value written is the SAME
    serving-profile identity the list endpoints already stamp onto outgoing rows (``row_profile`` in
    ``get_sessions``). See #95407.
    """
    stamp = _serving_profile(body.profile)

    with http_failure(
        "POST /api/sessions/owner-backfill failed", 500, detail="Internal server error"):
        stamped = await asyncio.to_thread(
            _with_db, body.profile, lambda db: db.backfill_null_session_profiles(stamp),
            read_only=False)

    if stamped:
        _log.info(
            "owner-backfill: stamped %d legacy NULL-profile session row(s) with profile %r",
            stamped, stamp)
    return {"ok": True, "stamped": stamped, "profile": stamp}


# PATCH /api/sessions/{id} flag -> SessionDB setter, applied in this order.
_RENAME_FLAG_SETTERS = (
    ("archived", lambda db, sid, v: db.set_session_archived(sid, v)),
    ("hidden", lambda db, sid, v: db.set_session_hidden(sid, v)),
    ("pinned", lambda db, sid, v: db.set_session_pinned(sid, v)),
    ("unread", lambda db, sid, v: db.set_session_read(sid, read=not v)),
)


@manage_router.patch("/api/sessions/{session_id}")
async def rename_session_endpoint(session_id: str, body: SessionRename):
    """Update ``title`` (empty clears) and/or the flags; ``pinned`` exempts from
    the auto-archive sweep, ``unread=False`` marks read up to now."""
    flags = [flag for flag, _ in _RENAME_FLAG_SETTERS]

    def _update(db):
        sid = _resolve_session_id(db, session_id)
        if not sid:
            raise HTTPException(status_code=404, detail=_NOT_FOUND)
        if body.title is None and all(getattr(body, f) is None for f in flags):
            raise HTTPException(
                status_code=400,
                detail="Nothing to update; provide 'title', 'archived', 'hidden', 'pinned', and/or 'unread'.",
            )
        if body.title is not None:
            try:
                db.set_session_title(sid, body.title or "")
            except ValueError as e:
                # Title too long, invalid characters, or already in use.
                raise HTTPException(status_code=400, detail=str(e))
        result = {"ok": True, "title": None}
        for flag, setter in _RENAME_FLAG_SETTERS:
            value = getattr(body, flag)
            if value is not None:
                setter(db, sid, value)
                result[flag] = bool(value)
        result["title"] = db.get_session_title(sid) or ""
        return result

    return await asyncio.to_thread(_with_db, body.profile, _update, read_only=False)


def _compact_json(obj) -> str:
    return json.dumps(jsonable_encoder(obj), ensure_ascii=False, separators=(",", ":"))


@manage_router.get("/api/sessions/{session_id}/export")
async def export_session_endpoint(session_id: str, profile: Optional[str] = None):
    """Stream a single session (metadata + messages) as JSON."""
    cron_export = await asyncio.to_thread(_cron_output_export, profile, session_id)
    if cron_export is not None:
        return JSONResponse(cron_export)

    def _prepare_export(db):
        sid = _resolve_session_id(db, session_id)
        return (sid, db.get_session(sid)) if sid else None

    prepared = await asyncio.to_thread(_with_db, profile, _prepare_export, read_only=True)
    if prepared is None or prepared[1] is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)

    sid, session = prepared

    def _stream_export():
        db = _open_session_db_for_profile(profile, read_only=True)
        try:
            yield _compact_json(session)[:-1] + ',"messages":['
            # Keyset pagination (id > last_seen): O(n) total over the
            # transcript, vs OFFSET's O(n²) on huge sessions. Every row with its
            # active/compacted flags, so re-importing restores compacted history as archived.
            last_id, first = 0, True
            while True:
                messages = db.get_messages(sid, limit=500, after_id=last_id, include_inactive=True)
                for message in messages:
                    yield ("" if first else ",") + _compact_json(message)
                    first = False
                last_id = messages[-1].get("id") if len(messages) == 500 else None
                if last_id is None:  # short page, or cannot keyset without row ids
                    break
            yield "]}"
        finally:
            db.close()

    return StreamingResponse(_stream_export(), media_type="application/json")


@manage_router.post("/api/sessions/prune")
async def prune_sessions_endpoint(body: SessionPrune):
    """Delete ended sessions matching filters without blocking the event loop."""
    if not body.dry_run:
        # Same destructive rule as the rest of the family; a dry run deletes nothing, so it
        # keeps working unnamed (it is the preview the confirm dialog reads).
        body = body.model_copy(update={
            "profile": destructive_profile(body.profile, "POST /api/sessions/prune")})
    return await asyncio.to_thread(_prune_sessions, body)
