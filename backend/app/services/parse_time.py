from datetime import datetime, timezone

from app.db.models import Paper, utc_now


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def parse_elapsed_seconds(paper: Paper) -> int:
    if not paper.parse_started_at:
        return 0
    start = ensure_utc(paper.parse_started_at)
    if paper.status in ("parsed", "noting", "done", "failed"):
        if not paper.parse_finished_at:
            return 0
        end = ensure_utc(paper.parse_finished_at)
        return max(0, int((end - start).total_seconds()))
    return max(0, int((utc_now() - start).total_seconds()))
