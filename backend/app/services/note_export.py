import base64
import io
import os
import re
import zipfile
from pathlib import Path

import markdown

_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_API_FILE_RE = re.compile(r"/api/papers/\d+/files/(.+)")
_PDF_FONT: str | None = None


def _resolve_api_rel_path(url: str) -> str | None:
    clean = url.split("?", 1)[0].strip()
    if clean.startswith("data:"):
        return None
    m = _API_FILE_RE.search(clean)
    if m:
        return m.group(1).lstrip("/")
    if clean.startswith("assets/") or clean.startswith("images/"):
        return clean.lstrip("/")
    if clean.startswith("./"):
        return clean[2:].lstrip("/")
    return None


def _resolve_asset_file(data_dir: Path, rel: str) -> Path | None:
    """与 get_mineru_file 一致：images/* 在 mineru/ 下，assets/* 在 data_dir 根下。"""
    clean = rel.lstrip("/")
    if not clean:
        return None
    base = data_dir if clean.startswith("assets/") else data_dir / "mineru"
    target = (base / clean).resolve()
    data_root = data_dir.resolve()
    if not str(target).startswith(str(data_root)) or not target.is_file():
        return None
    return target


def _mineru_zip_path(data_dir: Path) -> Path | None:
    candidate = data_dir / "mineru" / "mineru_result.zip"
    if candidate.is_file():
        return candidate
    for p in data_dir.glob("mineru/**/*.zip"):
        if p.is_file():
            return p
    return None


def _extract_zip_member(zip_path: Path, member_suffix: str, cache_dir: Path) -> Path | None:
    """从 MinerU zip 按后缀匹配提取图片到缓存目录。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = Path(member_suffix).name
    dest = cache_dir / name
    if dest.is_file():
        return dest
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if info.filename.replace("\\", "/").endswith(member_suffix.replace("\\", "/")):
                    dest.write_bytes(zf.read(info.filename))
                    return dest
                if Path(info.filename).name == name:
                    dest.write_bytes(zf.read(info.filename))
                    return dest
    except (OSError, zipfile.BadZipFile):
        return None
    return None


def _find_asset_file(data_dir: Path, rel: str) -> Path | None:
    from app.services.note_content import fuzzy_resolve_image_rel
    from app.services.note_sections import normalize_figure_rel_path, resolve_paper_file_path

    clean = normalize_figure_rel_path(rel)
    if clean:
        resolved = resolve_paper_file_path(data_dir, clean)
        if resolved:
            return resolved

    direct = _resolve_asset_file(data_dir, rel)
    if direct:
        return direct

    name = Path(rel).name
    if name:
        for p in data_dir.rglob(name):
            if p.is_file() and str(p.resolve()).startswith(str(data_dir.resolve())):
                return p

    zip_path = _mineru_zip_path(data_dir)
    if zip_path:
        cached = _extract_zip_member(zip_path, rel, data_dir / ".export_cache")
        if cached:
            return cached

    if clean:
        corrected = fuzzy_resolve_image_rel(data_dir, clean)
        if corrected:
            resolved = resolve_paper_file_path(data_dir, corrected)
            if resolved:
                return resolved

    return None


def _image_mime(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(ext, "image/jpeg")


def _image_to_data_uri(path: Path, max_bytes: int = 900_000) -> str:
    raw = path.read_bytes()
    if len(raw) > max_bytes:
        try:
            from PIL import Image

            img = Image.open(io.BytesIO(raw))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85, optimize=True)
            raw = buf.getvalue()
            mime = "image/jpeg"
        except Exception:
            mime = _image_mime(path)
    else:
        mime = _image_mime(path)
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _embed_images_in_markdown(md: str, data_dir: Path) -> tuple[str, int, int]:
    embedded = 0
    missing = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal embedded, missing
        alt, raw = match.group(1), match.group(2).strip()
        if raw.startswith("data:"):
            return match.group(0)
        rel = _resolve_api_rel_path(raw)
        if not rel:
            missing += 1
            return match.group(0)
        path = _find_asset_file(data_dir, rel)
        if not path:
            missing += 1
            return f"**[图片: {alt or rel}]**"
        embedded += 1
        return f"![{alt}]({_image_to_data_uri(path)})"

    return _IMG_RE.sub(repl, md), embedded, missing


def _collect_assets(md: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in _IMG_RE.finditer(md):
        raw = m.group(2).strip()
        rel = _resolve_api_rel_path(raw)
        if not rel or rel in seen:
            continue
        seen.add(rel)
        pairs.append((raw, rel))
    return pairs


def _rewrite_md_paths(md: str, mapping: dict[str, str]) -> str:
    def repl(match: re.Match[str]) -> str:
        alt, raw = match.group(1), match.group(2).strip()
        target = mapping.get(raw, mapping.get(raw.split("?", 1)[0], raw))
        return f"![{alt}]({target})"

    return _IMG_RE.sub(repl, md)


def _zip_md_path(rel: str) -> str:
    clean = rel.lstrip("/")
    return clean if clean.startswith("./") else f"./{clean}"


def _register_pdf_font() -> str:
    global _PDF_FONT
    if _PDF_FONT:
        return _PDF_FONT

    from reportlab.pdfbase import pdfmetrics

    try:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont

        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        _PDF_FONT = "STSong-Light"
        return _PDF_FONT
    except Exception:
        pass

    try:
        from reportlab.pdfbase.ttfonts import TTFont

        windir = os.environ.get("WINDIR", r"C:\Windows")
        for font_name, fname in (
            ("YaHei", "msyh.ttc"),
            ("SimSun", "simsun.ttc"),
            ("SimHei", "simhei.ttf"),
        ):
            path = os.path.join(windir, "Fonts", fname)
            if os.path.isfile(path):
                pdfmetrics.registerFont(TTFont(font_name, path))
                _PDF_FONT = font_name
                return _PDF_FONT
    except Exception:
        pass

    _PDF_FONT = "Helvetica"
    return _PDF_FONT


def _embed_images_as_base64(html: str, data_dir: Path) -> str:
    def repl(match: re.Match[str]) -> str:
        src = match.group(1).strip()
        if src.startswith("data:"):
            return match.group(0)
        rel = _resolve_api_rel_path(src)
        if not rel:
            if src.startswith("./"):
                rel = src[2:]
            elif src.startswith("http"):
                return match.group(0)
            else:
                rel = src.lstrip("/")
        path = _find_asset_file(data_dir, rel) if rel else None
        if not path:
            return match.group(0)
        data_uri = _image_to_data_uri(path)
        return f'src="{data_uri}"'

    return re.sub(r'src="([^"]+)"', repl, html)


_HTML_CSS = """
body {
  font-family: "PingFang SC", "Source Serif 4", Georgia, serif;
  font-size: 16px;
  line-height: 1.72;
  color: #202124;
  max-width: 920px;
  margin: 0 auto;
  padding: 32px 24px;
}
h1, h2, h3, h4 {
  font-family: Inter, "PingFang SC", sans-serif;
  font-weight: 600;
  line-height: 1.35;
  color: #0f1419;
}
h1 { font-size: 1.85em; border-bottom: 1px solid #eef0f3; padding-bottom: 0.3em; }
h2 { font-size: 1.45em; }
h3 { font-size: 1.2em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
th { background: #f7f8fa; font-weight: 600; }
blockquote {
  margin: 1em 0; padding: 0.4em 1em;
  border-left: 3px solid #d6dee7; background: #f7f8fa; color: #4e5969;
}
code { background: #f3f4f6; color: #c7254e; padding: 0.12em 0.36em; border-radius: 4px; }
pre { background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: transparent; color: inherit; padding: 0; }
img { max-width: 100%; height: auto; display: block; margin: 0.8em auto; border-radius: 6px; }
a { color: #1677ff; text-decoration: none; }
center { display: block; text-align: center; color: #86909c; font-size: 0.9em; margin: 0.4em 0 1em; }
"""


def _build_standalone_html(export_md: str, data_dir: Path, title: str) -> str:
    body = markdown.markdown(export_md, extensions=["tables", "fenced_code", "nl2br"])
    body = _embed_images_as_base64(body, data_dir)
    safe_title = title.replace("<", "").replace(">", "")
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{safe_title}</title>
<style>{_HTML_CSS}</style>
</head><body>{body}</body></html>"""


def build_note_zip(data_dir: Path, title: str) -> bytes:
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记不存在")

    md = note_path.read_text(encoding="utf-8")
    mapping: dict[str, str] = {}
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for raw, rel in _collect_assets(md):
            src = _find_asset_file(data_dir, rel)
            if not src:
                continue
            zip_path = rel
            md_path = _zip_md_path(rel)
            mapping[raw] = md_path
            mapping[raw.split("?", 1)[0]] = md_path
            zf.write(src, zip_path)

        export_md, _, _ = _embed_images_in_markdown(md, data_dir)
        export_md = _rewrite_md_paths(export_md, mapping) if mapping else export_md
        zf.writestr("note.md", export_md)
        zf.writestr("note.html", _build_standalone_html(export_md, data_dir, title))

    buf.seek(0)
    return buf.read()


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _inline_md_to_reportlab(text: str) -> str:
    text = _escape_xml(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text


_DATA_URI_RE = re.compile(r"^data:([^;]+);base64,(.+)$", re.DOTALL)


def _decode_data_uri(uri: str) -> bytes | None:
    m = _DATA_URI_RE.match(uri.strip())
    if not m:
        return None
    try:
        return base64.b64decode(m.group(2))
    except Exception:
        return None


def _image_flowable(src: str, max_width: float) -> list:
    from reportlab.platypus import Image as RLImage, Spacer

    raw: bytes | None = None
    if src.startswith("data:"):
        raw = _decode_data_uri(src)
    elif src.startswith("./"):
        path = Path(src)
        if path.is_file():
            raw = path.read_bytes()
    if not raw:
        return []

    try:
        from PIL import Image as PILImage

        pil = PILImage.open(io.BytesIO(raw))
        w, h = pil.size
        if w <= 0 or h <= 0:
            return []
        scale = min(max_width / w, 1.0)
        display_w = w * scale
        display_h = h * scale
        return [
            Spacer(1, 6),
            RLImage(io.BytesIO(raw), width=display_w, height=display_h),
            Spacer(1, 6),
        ]
    except Exception:
        return []


def _parse_table_rows(lines: list[str]) -> list[list[str]] | None:
    rows: list[list[str]] = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|"):
            break
        if re.match(r"^\|?[\s\-:|]+\|?$", stripped):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if cells:
            rows.append(cells)
    return rows or None


def _table_flowable(rows: list[list[str]], font_name: str, available_width: float):
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle

    col_count = max(len(r) for r in rows)
    normalized = [r + [""] * (col_count - len(r)) for r in rows]

    if col_count >= 7:
        font_size = 7
    elif col_count >= 5:
        font_size = 8
    else:
        font_size = 9

    cell_style = ParagraphStyle(
        "YanxiTableCell",
        fontName=font_name,
        fontSize=font_size,
        leading=font_size + 3,
        wordWrap="CJK",
    )
    header_style = ParagraphStyle(
        "YanxiTableHeader",
        parent=cell_style,
        fontName=font_name,
        fontSize=font_size,
        leading=font_size + 3,
    )

    col_width = available_width / col_count
    col_widths = [col_width] * col_count

    wrapped_rows: list[list] = []
    for row_idx, row in enumerate(normalized):
        style = header_style if row_idx == 0 else cell_style
        wrapped_rows.append(
            [
                Paragraph(_inline_md_to_reportlab(cell), style)
                if cell
                else Paragraph(" ", style)
                for cell in row
            ]
        )

    table = Table(
        wrapped_rows,
        colWidths=col_widths,
        repeatRows=1,
        splitByRow=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("FONTSIZE", (0, 0), (-1, -1), font_size),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f7f8fa")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e6eb")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _build_pdf_reportlab(export_md: str, title: str, font_name: str) -> bytes:
    """使用 ReportLab 直接生成 PDF，避免 xhtml2pdf/pyHanko/cryptography ML-DSA 依赖。"""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title[:120],
    )
    max_img_width = A4[0] - 40 * mm
    content_width = max_img_width

    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "YanxiBody",
        parent=styles["Normal"],
        fontName=font_name,
        fontSize=11,
        leading=16,
        alignment=TA_LEFT,
    )
    h1 = ParagraphStyle(
        "YanxiH1", parent=body, fontSize=18, leading=24, spaceAfter=8, spaceBefore=12
    )
    h2 = ParagraphStyle(
        "YanxiH2", parent=body, fontSize=15, leading=20, spaceAfter=6, spaceBefore=10
    )
    h3 = ParagraphStyle(
        "YanxiH3", parent=body, fontSize=13, leading=18, spaceAfter=4, spaceBefore=8
    )
    quote = ParagraphStyle(
        "YanxiQuote",
        parent=body,
        leftIndent=12,
        textColor=colors.HexColor("#4e5969"),
        borderPadding=4,
    )

    flowables: list = []
    if title:
        flowables.append(Paragraph(_inline_md_to_reportlab(title), h1))
        flowables.append(Spacer(1, 8))

    lines = export_md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        img_match = _IMG_RE.match(stripped)
        if img_match:
            flowables.extend(_image_flowable(img_match.group(2).strip(), max_img_width))
            i += 1
            continue

        if stripped.startswith("|"):
            table_lines: list[str] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = _parse_table_rows(table_lines)
            if rows:
                flowables.append(_table_flowable(rows, font_name, content_width))
                flowables.append(Spacer(1, 8))
            continue

        if stripped.startswith("### "):
            flowables.append(Paragraph(_inline_md_to_reportlab(stripped[4:]), h3))
        elif stripped.startswith("## "):
            flowables.append(Paragraph(_inline_md_to_reportlab(stripped[3:]), h2))
        elif stripped.startswith("# "):
            flowables.append(Paragraph(_inline_md_to_reportlab(stripped[2:]), h1))
        elif stripped.startswith("> "):
            flowables.append(Paragraph(_inline_md_to_reportlab(stripped[2:]), quote))
        elif stripped in ("---", "***", "___"):
            flowables.append(Spacer(1, 10))
        elif not stripped:
            flowables.append(Spacer(1, 6))
        else:
            flowables.append(Paragraph(_inline_md_to_reportlab(stripped), body))
        i += 1

    doc.build(flowables)
    pdf_bytes = buf.getvalue()
    if not pdf_bytes.startswith(b"%PDF"):
        raise RuntimeError("ReportLab 未生成有效 PDF")
    return pdf_bytes


def build_note_pdf(data_dir: Path, title: str) -> bytes:
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记不存在")

    md = note_path.read_text(encoding="utf-8")
    export_md, embedded, missing = _embed_images_in_markdown(md, data_dir)
    font_name = _register_pdf_font()
    try:
        return _build_pdf_reportlab(export_md, title, font_name)
    except Exception as e:
        detail = f"embedded={embedded}, missing={missing}, font={font_name}"
        raise RuntimeError(f"PDF 生成失败（{detail}）: {e}") from e


def save_note_pdf(data_dir: Path, title: str, dest: Path | None = None) -> Path:
    """生成 PDF 并写入 data_dir/note_export.pdf（或指定路径）。"""
    pdf_bytes = build_note_pdf(data_dir, title)
    out = dest or (data_dir / "note_export.pdf")
    out.write_bytes(pdf_bytes)
    return out
