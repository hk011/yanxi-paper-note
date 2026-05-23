import base64
import io
import re
import zipfile
from pathlib import Path

import markdown

_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_API_FILE_RE = re.compile(r"/api/papers/\d+/files/(.+)")


def _resolve_api_rel_path(url: str) -> str | None:
    clean = url.split("?", 1)[0].strip()
    m = _API_FILE_RE.search(clean)
    if m:
        return m.group(1).lstrip("/")
    if clean.startswith("assets/") or clean.startswith("images/"):
        return clean.lstrip("/")
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


def _embed_images_as_base64(html: str, data_dir: Path) -> str:
    def repl(match: re.Match[str]) -> str:
        src = match.group(1).strip()
        rel = _resolve_api_rel_path(src)
        if not rel:
            if src.startswith("./"):
                rel = src[2:]
            elif src.startswith("data:") or src.startswith("http"):
                return match.group(0)
            else:
                rel = src.lstrip("/")
        path = _resolve_asset_file(data_dir, rel)
        if not path:
            return match.group(0)
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        return f'src="data:{mime};base64,{b64}"'

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
            src = _resolve_asset_file(data_dir, rel)
            if not src:
                continue
            zip_path = rel
            md_path = _zip_md_path(rel)
            mapping[raw] = md_path
            mapping[raw.split("?", 1)[0]] = md_path
            zf.write(src, zip_path)

        export_md = _rewrite_md_paths(md, mapping)
        zf.writestr("note.md", export_md)
        zf.writestr("note.html", _build_standalone_html(export_md, data_dir, title))

    buf.seek(0)
    return buf.read()


_CJK_FONT = "STSong-Light"


def _pdf_css() -> str:
    text_font = _CJK_FONT
    return f"""
body {{
  font-family: {text_font};
  font-size: 12px;
  line-height: 1.65;
  color: #1d2129;
  padding: 24px;
}}
h1, h2, h3, h4, p, li, td, th, blockquote {{
  font-family: {text_font};
  color: #1d2129;
}}
h1, h2, h3, h4 {{ margin-top: 1.2em; }}
table {{ border-collapse: collapse; width: 100%; margin: 12px 0; }}
th, td {{ border: 1px solid #e5e6eb; padding: 6px 8px; text-align: left; }}
blockquote {{ border-left: 3px solid #1677ff; margin: 12px 0; padding: 4px 12px; color: #4e5969; }}
img {{ max-width: 100%; height: auto; margin: 8px 0; }}
code, pre {{ font-family: Courier; background: #f7f8fa; padding: 1px 4px; border-radius: 4px; }}
pre {{ padding: 10px; border-radius: 6px; white-space: pre-wrap; }}
"""


def build_note_pdf(data_dir: Path, title: str) -> bytes:
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记不存在")

    md = note_path.read_text(encoding="utf-8")
    body = markdown.markdown(md, extensions=["tables", "fenced_code", "nl2br"])
    body = _embed_images_as_base64(body, data_dir)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{_pdf_css()}</style></head>
<body>{body}</body></html>"""

    from xhtml2pdf import pisa

    out = io.BytesIO()
    result = pisa.CreatePDF(html, dest=out, encoding="utf-8")
    if result.err:
        raise RuntimeError("PDF 生成失败")
    return out.getvalue()
