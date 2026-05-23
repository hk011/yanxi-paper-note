import io
import json
import re
import zipfile
from pathlib import Path

import httpx

from app.core.config import get_settings

_DETAILS_BLOCK_RE = re.compile(r"<details>.*?</details>\s*", re.DOTALL | re.IGNORECASE)


def clean_mineru_markdown(text: str) -> str:
    """剥离 MinerU 二次解析出的 <details>...</details> 块（mermaid / 饼图等）。
    原图引用 ![](images/xxx) 在 details 之外，不受影响。"""
    return _DETAILS_BLOCK_RE.sub("", text)


_PDF_PAGE_RE = re.compile(rb"/Type\s*/Page\b")


def count_pdf_pages(file_path: Path) -> int:
    try:
        return len(_PDF_PAGE_RE.findall(file_path.read_bytes()))
    except OSError:
        return 0

MINERU_HEADERS = {"Content-Type": "application/json", "Accept": "*/*"}


def _auth_headers() -> dict[str, str]:
    settings = get_settings()
    return {
        **MINERU_HEADERS,
        "Authorization": f"Bearer {settings.mineru_api_token}",
    }


async def submit_file_batch(filename: str, data_id: str) -> tuple[str, str]:
    """申请预签名 URL 并返回 (batch_id, upload_url)"""
    settings = get_settings()
    url = f"{settings.mineru_base_url}/v4/file-urls/batch"
    body = {
        "files": [{"name": filename, "data_id": data_id}],
        "model_version": "vlm",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, headers=_auth_headers(), json=body)
        resp.raise_for_status()
        result = resp.json()
    if result.get("code") != 0:
        raise RuntimeError(result.get("msg", "MinerU 提交失败"))
    data = result["data"]
    return data["batch_id"], data["file_urls"][0]


async def upload_to_presigned_url(upload_url: str, file_path: Path) -> None:
    async with httpx.AsyncClient(timeout=300.0) as client:
        with file_path.open("rb") as f:
            resp = await client.put(upload_url, content=f.read())
        resp.raise_for_status()


async def poll_batch_result(batch_id: str) -> dict:
    settings = get_settings()
    url = f"{settings.mineru_base_url}/v4/extract-results/batch/{batch_id}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, headers=_auth_headers())
        resp.raise_for_status()
        result = resp.json()
    if result.get("code") != 0:
        raise RuntimeError(result.get("msg", "MinerU 查询失败"))
    return result["data"]


async def download_and_extract_zip(zip_url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(zip_url)
        resp.raise_for_status()
        content = resp.content

    zip_path = dest_dir / "mineru_result.zip"
    zip_path.write_bytes(content)

    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        zf.extractall(dest_dir)

    return zip_path


def find_markdown(dest_dir: Path) -> Path | None:
    for name in ("full.md", "auto/full.md"):
        p = dest_dir / name
        if p.exists():
            return p
    for p in dest_dir.rglob("full.md"):
        return p
    for p in dest_dir.rglob("*.md"):
        if p.name != "README.md":
            return p
    return None


def find_content_list(dest_dir: Path) -> dict | list | None:
    candidates = list(dest_dir.rglob("content_list_v2.json")) + list(
        dest_dir.rglob("content_list.json")
    )
    if not candidates:
        return None
    with candidates[0].open(encoding="utf-8") as f:
        return json.load(f)


def paper_data_dir(user_id: int, paper_id: int) -> Path:
    settings = get_settings()
    return settings.data_dir / str(user_id) / str(paper_id)
