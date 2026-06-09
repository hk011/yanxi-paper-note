from pathlib import Path

from app.services.mineru import paper_data_dir

# 长边目标像素（约 2x 卡片宽度，适配 Retina）
THUMBNAIL_MAX_EDGE = 960
THUMBNAIL_MIN_EDGE = 720
THUMBNAIL_JPEG_QUALITY = 92


def thumbnail_path(user_id: int, paper_id: int) -> Path:
    return paper_data_dir(user_id, paper_id) / "thumbnail.jpg"


def _thumb_is_sharp_enough(path: Path) -> bool:
    try:
        import fitz  # pymupdf

        img = fitz.open(path)
        page = img.load_page(0)
        w, h = page.rect.width, page.rect.height
        img.close()
        return max(w, h) >= THUMBNAIL_MIN_EDGE
    except Exception:
        return False


def ensure_thumbnail(user_id: int, paper_id: int, pdf_path: str | Path) -> Path | None:
    pdf = Path(pdf_path)
    if not pdf.exists():
        return None
    out = thumbnail_path(user_id, paper_id)
    if out.exists() and out.stat().st_size > 0 and _thumb_is_sharp_enough(out):
        return out
    if out.exists():
        out.unlink(missing_ok=True)
    try:
        import fitz  # pymupdf
    except ImportError:
        return None
    try:
        doc = fitz.open(pdf)
        if doc.page_count == 0:
            doc.close()
            return None
        page = doc.load_page(0)
        rect = page.rect
        scale = min(
            THUMBNAIL_MAX_EDGE / max(rect.width, 1),
            THUMBNAIL_MAX_EDGE / max(rect.height, 1),
            3.0,
        )
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        out.parent.mkdir(parents=True, exist_ok=True)
        pix.save(str(out), jpg_quality=THUMBNAIL_JPEG_QUALITY)
        doc.close()
        return out if out.exists() else None
    except Exception:
        return None
