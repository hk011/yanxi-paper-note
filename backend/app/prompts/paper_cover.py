def build_cover_prompt(*, title: str, summary: str, palette: str = "") -> str:
    topic = summary.strip() or title.strip() or "academic research"
    palette_line = f"Color palette: {palette}. " if palette else ""
    return (
        "Minimal abstract academic cover illustration. "
        f"Topic: {topic}. "
        f"{palette_line}"
        "Clean, calm, comfortable composition, soft light, 16:9 banner."
    )
