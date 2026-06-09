import asyncio
import json
from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Paper, utc_now
from app.db.session import get_engine
from app.schemas.events import StreamEvent
from app.services.mineru import (
    clean_mineru_markdown,
    download_and_extract_zip,
    find_content_list,
    find_markdown,
    paper_data_dir,
    poll_batch_result,
    submit_file_batch,
    upload_to_presigned_url,
)
from app.services.parse_time import parse_elapsed_seconds

POLL_INTERVAL_SECONDS = 1.0
PENDING_FAIL_SECONDS = 30 * 60

# paper_id -> asyncio.Queue for SSE subscribers
_parse_queues: dict[int, asyncio.Queue[StreamEvent | None]] = {}
_active_parse_jobs: set[int] = set()


def get_parse_queue(paper_id: int) -> asyncio.Queue[StreamEvent | None]:
    if paper_id not in _parse_queues:
        _parse_queues[paper_id] = asyncio.Queue()
    return _parse_queues[paper_id]


def reset_parse_queue(paper_id: int) -> asyncio.Queue[StreamEvent | None]:
    _parse_queues[paper_id] = asyncio.Queue()
    return _parse_queues[paper_id]


def remove_parse_queue(paper_id: int) -> None:
    _parse_queues.pop(paper_id, None)


def is_parse_job_active(paper_id: int) -> bool:
    return paper_id in _active_parse_jobs


def _as_int(value: object) -> int:
    try:
        return int(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0


def _extract_running_progress(item: dict) -> tuple[int, int]:
    """MinerU 文档：extract_progress 仅在 state=running 时有效。"""
    progress = item.get("extract_progress") or {}
    extracted = _as_int(progress.get("extracted_pages"))
    total = _as_int(progress.get("total_pages"))
    return extracted, total


async def _emit_parse_progress(
    paper_id: int,
    paper: Paper,
    mineru_state: str,
    parsed_pages: int,
    total_pages: int,
) -> None:
    await _emit(
        paper_id,
        StreamEvent(
            type="status",
            data={
                "status": "parsing",
                "mineru_state": mineru_state,
                "parsed_pages": parsed_pages,
                "total_pages": total_pages,
                "parse_elapsed_seconds": parse_elapsed_seconds(paper),
            },
        ),
    )


async def _emit(paper_id: int, event: StreamEvent) -> None:
    q = get_parse_queue(paper_id)
    await q.put(event)


def _update_paper(session: Session, paper: Paper, **kwargs) -> Paper:
    for k, v in kwargs.items():
        setattr(paper, k, v)
    session.add(paper)
    session.commit()
    session.refresh(paper)
    return paper


async def _poll_mineru_until_done(
    *,
    paper_id: int,
    user_id: int,
    batch_id: str,
    original_filename: str,
) -> None:
    engine = get_engine()
    last_parsed_pages = 0
    last_total_pages = 0

    while True:
        data = await poll_batch_result(batch_id)
        results = data.get("extract_result") or []
        if not results:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue

        item = results[0]
        state = item.get("state", "")

        with Session(engine) as session:
            paper = session.get(Paper, paper_id)
            if not paper:
                return

            total_pages = paper.total_pages
            parsed_pages = paper.parsed_pages or last_parsed_pages

            if state == "running":
                extracted, mineru_total = _extract_running_progress(item)
                if extracted > 0:
                    parsed_pages = extracted
                    last_parsed_pages = extracted
                if mineru_total > 0:
                    total_pages = mineru_total
                    last_total_pages = mineru_total
                _update_paper(
                    session,
                    paper,
                    parsed_pages=parsed_pages,
                    total_pages=total_pages,
                )
            elif state in ("pending", "waiting-file", "converting", "uploading"):
                if paper.total_pages > 0:
                    total_pages = paper.total_pages
                parsed_pages = paper.parsed_pages or last_parsed_pages
                total_pages = total_pages or last_total_pages
                elapsed = parse_elapsed_seconds(paper)
                if state == "pending" and elapsed >= PENDING_FAIL_SECONDS:
                    raise RuntimeError(
                        "MinerU 排队超过 30 分钟仍未开始，请删除后重新上传"
                    )

            await _emit_parse_progress(
                paper_id,
                paper,
                state or "pending",
                parsed_pages,
                total_pages,
            )

        if state == "done":
            zip_url = item.get("full_zip_url", "")
            dest = paper_data_dir(user_id, paper_id) / "mineru"
            zip_path = await download_and_extract_zip(zip_url, dest)

            md_src = find_markdown(dest)
            md_dest = paper_data_dir(user_id, paper_id) / "parsed.md"
            if md_src:
                cleaned = clean_mineru_markdown(md_src.read_text(encoding="utf-8"))
                md_dest.write_text(cleaned, encoding="utf-8")

            content_list = find_content_list(dest)
            if content_list is not None:
                cl_path = paper_data_dir(user_id, paper_id) / "content_list.json"
                cl_path.write_text(
                    json.dumps(content_list, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

            title = Path(original_filename).stem
            final_total = last_total_pages
            with Session(engine) as session:
                paper = session.get(Paper, paper_id)
                if paper:
                    final_total = last_total_pages or paper.total_pages
                    _update_paper(
                        session,
                        paper,
                        status="parsed",
                        title=title,
                        mineru_zip_path=str(zip_path),
                        markdown_path=str(md_dest) if md_dest.exists() else "",
                        parsed_pages=final_total,
                        total_pages=final_total,
                        parse_finished_at=utc_now(),
                    )

            await _emit(
                paper_id,
                StreamEvent(
                    type="status",
                    data={
                        "status": "parsed",
                        "parsed_pages": final_total,
                        "total_pages": final_total,
                    },
                ),
            )
            from app.services.paper_enrichment import schedule_paper_enrichment

            schedule_paper_enrichment(paper_id, user_id)
            return

        if state == "failed":
            err = item.get("err_msg", "解析失败")
            with Session(engine) as session:
                paper = session.get(Paper, paper_id)
                if paper:
                    _update_paper(
                        session,
                        paper,
                        status="failed",
                        error_message=err,
                        parse_finished_at=utc_now(),
                    )
            await _emit(
                paper_id,
                StreamEvent(type="status", data={"status": "failed", "error": err}),
            )
            await _emit(paper_id, StreamEvent(type="done", data={}))
            return

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def run_parse_pipeline(paper_id: int, user_id: int) -> None:
    if paper_id in _active_parse_jobs:
        return
    _active_parse_jobs.add(paper_id)

    engine = get_engine()
    try:
        with Session(engine) as session:
            paper = session.get(Paper, paper_id)
            if not paper or paper.user_id != user_id:
                return
            pdf_path = Path(paper.pdf_path)
            original_filename = paper.title or pdf_path.name
            filename = (
                original_filename
                if original_filename.lower().endswith(".pdf")
                else pdf_path.name
            )
            data_id = f"yanxi-{paper_id}"
            existing_batch_id = (paper.mineru_task_id or "").strip()

        await _emit(paper_id, StreamEvent(type="status", data={"status": "parsing"}))

        if existing_batch_id:
            batch_id = existing_batch_id
        else:
            batch_id, upload_url = await submit_file_batch(filename, data_id)
            await upload_to_presigned_url(upload_url, pdf_path)

            with Session(engine) as session:
                paper = session.get(Paper, paper_id)
                if paper:
                    _update_paper(
                        session,
                        paper,
                        mineru_task_id=batch_id,
                        status="parsing",
                        parse_started_at=paper.parse_started_at or utc_now(),
                    )

        await _poll_mineru_until_done(
            paper_id=paper_id,
            user_id=user_id,
            batch_id=batch_id,
            original_filename=original_filename,
        )

    except Exception as e:
        with Session(get_engine()) as session:
            paper = session.get(Paper, paper_id)
            if paper:
                _update_paper(
                    session,
                    paper,
                    status="failed",
                    error_message=str(e),
                    parse_finished_at=utc_now(),
                )
        await _emit(
            paper_id,
            StreamEvent(type="status", data={"status": "failed", "error": str(e)}),
        )
        await _emit(paper_id, StreamEvent(type="done", data={}))
    finally:
        _active_parse_jobs.discard(paper_id)
        with Session(get_engine()) as session:
            paper = session.get(Paper, paper_id)
            if paper and paper.status in ("failed", "parsing", "uploading", "parsed"):
                q = get_parse_queue(paper_id)
                await q.put(None)


def schedule_parse_pipeline(paper_id: int, user_id: int) -> None:
    """在事件循环中启动解析；若已有任务在跑则跳过。"""
    if paper_id in _active_parse_jobs:
        return
    asyncio.create_task(run_parse_pipeline(paper_id, user_id))


async def resume_stuck_parse_jobs() -> None:
    """服务启动或 SSE 重连时，恢复仍在 parsing 的论文轮询。"""
    with Session(get_engine()) as session:
        papers = session.exec(
            select(Paper).where(Paper.status.in_(["parsing", "uploading"]))
        ).all()
        for paper in papers:
            schedule_parse_pipeline(paper.id, paper.user_id)
