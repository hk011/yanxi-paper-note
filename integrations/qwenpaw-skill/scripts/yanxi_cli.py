#!/usr/bin/env python3
"""研析 CLI — 供 QwenPaw Skill 通过 execute_shell_command 调用。

与 Web 端相同：POST /api/skill/process 跑完解析 + 笔记流水线，
再 GET /api/skill/papers/{id}/note/export/pdf 下载**带图片内嵌**的 PDF。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("请先安装: pip install httpx", file=sys.stderr)
    sys.exit(1)

DEFAULT_BASE = "http://127.0.0.1:8000"


def _headers() -> dict[str, str]:
    api_key = (os.environ.get("YANXI_API_KEY") or "").strip()
    if api_key:
        return {"X-Yanxi-Api-Key": api_key}
    token = (os.environ.get("YANXI_ACCESS_TOKEN") or "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}
    user = (os.environ.get("YANXI_USERNAME") or "").strip()
    pwd = os.environ.get("YANXI_PASSWORD") or ""
    if user and pwd:
        with httpx.Client(timeout=60.0) as client:
            base = (os.environ.get("YANXI_BASE_URL") or DEFAULT_BASE).rstrip("/")
            r = client.post(
                f"{base}/api/auth/login",
                json={"username": user, "password": pwd},
            )
            r.raise_for_status()
            token = r.json()["access_token"]
            return {"Authorization": f"Bearer {token}"}
    print(
        "错误: 请配置 YANXI_API_KEY，或 YANXI_USERNAME+YANXI_PASSWORD",
        file=sys.stderr,
    )
    sys.exit(2)


def _base() -> str:
    return (os.environ.get("YANXI_BASE_URL") or DEFAULT_BASE).rstrip("/")


def _is_valid_pdf(path: Path) -> bool:
    try:
        head = path.read_bytes()[:8]
    except OSError:
        return False
    return head.startswith(b"%PDF")


def _download_note_pdf(
    client: httpx.Client,
    paper_id: int,
    dest: Path,
    headers: dict[str, str],
) -> Path:
    r = client.get(
        f"{_base()}/api/skill/papers/{paper_id}/note/export/pdf",
        headers=headers,
    )
    if r.status_code >= 400:
        detail = r.text
        try:
            detail = r.json().get("detail", detail)
        except Exception:
            pass
        raise RuntimeError(f"PDF 导出失败 HTTP {r.status_code}: {detail}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    if not _is_valid_pdf(dest):
        dest.unlink(missing_ok=True)
        raise RuntimeError("后端返回的不是有效 PDF 文件（请勿自行用 HTML 伪造 PDF）")
    return dest


def _download_note_zip(
    client: httpx.Client,
    paper_id: int,
    dest: Path,
    headers: dict[str, str],
) -> Path:
    r = client.get(
        f"{_base()}/api/skill/papers/{paper_id}/note/export/zip",
        headers=headers,
    )
    if r.status_code >= 400:
        detail = r.text
        try:
            detail = r.json().get("detail", detail)
        except Exception:
            pass
        raise RuntimeError(f"ZIP 导出失败 HTTP {r.status_code}: {detail}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return dest


def cmd_health(_: argparse.Namespace) -> int:
    with httpx.Client(timeout=30.0) as client:
        r = client.get(f"{_base()}/api/health")
        r.raise_for_status()
        info = client.get(f"{_base()}/api/skill/info")
        info.raise_for_status()
    print(json.dumps({"health": r.json(), "skill": info.json()}, ensure_ascii=False, indent=2))
    return 0


def cmd_process(args: argparse.Namespace) -> int:
    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.is_file():
        print(f"错误: PDF 不存在: {pdf}", file=sys.stderr)
        return 1
    if pdf.suffix.lower() != ".pdf":
        print("错误: 仅支持 .pdf", file=sys.stderr)
        return 1

    timeout = float(args.timeout)
    headers = _headers()
    print(f"[yanxi] 上传并处理: {pdf.name}（解析+笔记，与 Web 端相同流水线）…", file=sys.stderr)
    print(f"[yanxi] 预计耗时数分钟至数十分钟，请勿中断…", file=sys.stderr)

    with httpx.Client(timeout=timeout) as client:
        with pdf.open("rb") as f:
            r = client.post(
                f"{_base()}/api/skill/process",
                headers=headers,
                files={"file": (pdf.name, f, "application/pdf")},
            )
        if r.status_code >= 400:
            detail = r.text
            try:
                detail = r.json().get("detail", detail)
            except Exception:
                pass
            print(f"错误: HTTP {r.status_code}: {detail}", file=sys.stderr)
            return 1
        data = r.json()

        paper_id = data.get("paper_id")
        title = data.get("title", pdf.stem)
        note = data.get("note", "")
        embedded = data.get("images_embedded", 0)
        missing = data.get("images_missing", 0)
        if embedded or missing:
            print(
                f"[yanxi] 图片统计: 已嵌入 {embedded}，缺失 {missing}",
                file=sys.stderr,
            )
        if data.get("pdf_error"):
            print(f"[yanxi] 后端 PDF 预生成警告: {data['pdf_error']}", file=sys.stderr)

        md_path = pdf.with_name(f"{pdf.stem}_yanxi_note.md")
        primary: Path | None = None
        zip_path: Path | None = None

        if args.save_md or (args.output and str(args.output).lower().endswith(".md")):
            md_path = Path(args.output) if args.output else md_path
            md_path.write_text(note, encoding="utf-8")
            print(f"[yanxi] Markdown 已写入: {md_path}", file=sys.stderr)

        if args.no_pdf:
            primary = md_path if md_path.exists() else None
        else:
            if args.output and not str(args.output).lower().endswith(".md"):
                pdf_out = Path(args.output)
            else:
                pdf_out = pdf.with_name(f"{pdf.stem}_yanxi_note.pdf")
            print("[yanxi] 从后端下载带内嵌图片的 PDF…", file=sys.stderr)
            try:
                _download_note_pdf(client, paper_id, pdf_out, headers)
                primary = pdf_out
                print(
                    f"[yanxi] PDF 已写入: {pdf_out} ({pdf_out.stat().st_size} 字节)",
                    file=sys.stderr,
                )
            except RuntimeError as e:
                print(f"[yanxi] PDF 失败: {e}", file=sys.stderr)
                zip_out = pdf.with_name(f"{pdf.stem}_yanxi_note.zip")
                print("[yanxi] 改用 ZIP 导出（含 note.html + 图片文件）…", file=sys.stderr)
                _download_note_zip(client, paper_id, zip_out, headers)
                zip_path = zip_out
                primary = zip_out
                print(f"[yanxi] ZIP 已写入: {zip_out}", file=sys.stderr)

    meta_path = pdf.with_name(f"{pdf.stem}.yanxi.json")
    meta = {
        k: data[k]
        for k in (
            "paper_id",
            "title",
            "status",
            "note_length",
            "total_pages",
            "pdf_export_path",
            "zip_export_path",
            "pdf_available",
            "images_embedded",
            "images_missing",
        )
        if k in data
    }
    if primary:
        meta["deliverable_path"] = str(primary)
        meta["deliverable_type"] = "pdf" if str(primary).lower().endswith(".pdf") else "zip"
    if md_path.exists():
        meta["md_path"] = str(md_path)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[yanxi] 完成 paper_id={paper_id}", file=sys.stderr)
    print(f"[yanxi] 元数据: {meta_path}", file=sys.stderr)

    if args.json:
        out = {**data}
        if not args.no_pdf and primary:
            out["pdf_path"] = str(primary)
        if md_path.exists():
            out["md_path"] = str(md_path)
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif primary:
        print(primary)
    else:
        print(meta_path)

    if args.question and paper_id:
        print(f"[yanxi] 追问: {args.question}", file=sys.stderr)
        with httpx.Client(timeout=600.0) as client:
            ar = client.post(
                f"{_base()}/api/skill/papers/{paper_id}/ask",
                headers=headers,
                json={
                    "question": args.question,
                    "enable_search": True,
                    "enable_thinking": False,
                },
            )
            if ar.status_code >= 400:
                print(f"问答失败: {ar.text}", file=sys.stderr)
            else:
                ans = ar.json()
                qa_path = pdf.with_name(f"{pdf.stem}_yanxi_qa.json")
                qa_path.write_text(json.dumps(ans, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"[yanxi] 问答结果: {qa_path}", file=sys.stderr)

    return 0


def cmd_download_zip(args: argparse.Namespace) -> int:
    headers = _headers()
    dest = Path(args.output) if args.output else Path(f"paper_{args.paper_id}_note.zip")
    with httpx.Client(timeout=300.0) as client:
        _download_note_zip(client, args.paper_id, dest, headers)
    print(dest)
    return 0


def cmd_download_pdf(args: argparse.Namespace) -> int:
    headers = _headers()
    dest = Path(args.output) if args.output else Path(f"paper_{args.paper_id}_note.pdf")
    with httpx.Client(timeout=300.0) as client:
        _download_note_pdf(client, args.paper_id, dest, headers)
    print(dest)
    return 0


def cmd_list(_: argparse.Namespace) -> int:
    with httpx.Client(timeout=60.0) as client:
        r = client.get(f"{_base()}/api/skill/papers", headers=_headers())
        r.raise_for_status()
    print(json.dumps(r.json(), ensure_ascii=False, indent=2))
    return 0


def cmd_get_note(args: argparse.Namespace) -> int:
    headers = _headers()
    if args.format == "pdf":
        dest = Path(args.output) if args.output else Path(f"paper_{args.paper_id}_note.pdf")
        with httpx.Client(timeout=300.0) as client:
            _download_note_pdf(client, args.paper_id, dest, headers)
        print(dest)
        return 0

    with httpx.Client(timeout=120.0) as client:
        r = client.get(
            f"{_base()}/api/skill/papers/{args.paper_id}/note",
            headers=headers,
        )
        if r.status_code >= 400:
            print(f"错误: {r.text}", file=sys.stderr)
            return 1
    out = Path(args.output) if args.output else Path(f"paper_{args.paper_id}_note.md")
    out.write_text(r.text, encoding="utf-8")
    print(out)
    return 0


def cmd_ask(args: argparse.Namespace) -> int:
    with httpx.Client(timeout=600.0) as client:
        r = client.post(
            f"{_base()}/api/skill/papers/{args.paper_id}/ask",
            headers=_headers(),
            json={
                "question": args.question,
                "enable_search": not args.no_search,
                "enable_thinking": args.thinking,
            },
        )
        if r.status_code >= 400:
            print(f"错误: {r.text}", file=sys.stderr)
            return 1
    print(json.dumps(r.json(), ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="研析 Yanxi CLI（QwenPaw Skill）")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health", help="检查后端与 Skill API")

    p = sub.add_parser("process", help="上传 PDF，跑完整流水线并导出带图 PDF（推荐）")
    p.add_argument("pdf", help="PDF 文件路径")
    p.add_argument("-o", "--output", help="输出 PDF 路径（默认 <原名>_yanxi_note.pdf）")
    p.add_argument("-q", "--question", help="笔记生成后追加一次论文问答")
    p.add_argument("--json", action="store_true", help="向 stdout 打印完整 JSON")
    p.add_argument("--timeout", type=int, default=7200, help="HTTP 超时秒数（默认 7200）")
    p.add_argument("--save-md", action="store_true", help="同时保存 Markdown 副本")
    p.add_argument("--no-pdf", action="store_true", help="仅保留 Markdown，不导出 PDF")

    d = sub.add_parser("download-pdf", help="下载已有论文的带图 PDF")
    d.add_argument("paper_id", type=int)
    d.add_argument("-o", "--output")

    z = sub.add_parser("download-zip", help="下载 zip（note.html + 图片，PDF 失败时用）")
    z.add_argument("paper_id", type=int)
    z.add_argument("-o", "--output")

    sub.add_parser("list", help="列出论文")

    g = sub.add_parser("get-note", help="下载已有笔记（默认 PDF）")
    g.add_argument("paper_id", type=int)
    g.add_argument("-o", "--output")
    g.add_argument(
        "--format",
        choices=("pdf", "md"),
        default="pdf",
        help="输出格式（默认 pdf，含内嵌图片）",
    )

    a = sub.add_parser("ask", help="论文问答")
    a.add_argument("paper_id", type=int)
    a.add_argument("question")
    a.add_argument("--no-search", action="store_true")
    a.add_argument("--thinking", action="store_true")

    args = parser.parse_args()
    handlers = {
        "health": cmd_health,
        "process": cmd_process,
        "download-pdf": cmd_download_pdf,
        "download-zip": cmd_download_zip,
        "list": cmd_list,
        "get-note": cmd_get_note,
        "ask": cmd_ask,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
