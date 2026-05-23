export type PaperViewPane = "pdf" | "markdown" | "note";

const OPTIONS: { key: PaperViewPane; label: string }[] = [
  { key: "pdf", label: "原文" },
  { key: "markdown", label: "Markdown" },
  { key: "note", label: "笔记" },
];

interface Props {
  active: PaperViewPane[];
  onChange: (next: PaperViewPane[]) => void;
  hasMarkdown: boolean;
  noteAvailable: boolean;
}

export default function PaperViewToggles({
  active,
  onChange,
  hasMarkdown,
  noteAvailable,
}: Props) {
  const toggle = (pane: PaperViewPane) => {
    if (active.includes(pane)) {
      if (active.length <= 1) return;
      onChange(active.filter((p) => p !== pane));
      return;
    }
    const order: PaperViewPane[] = ["pdf", "markdown", "note"];
    onChange(
      [...active, pane].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    );
  };

  return (
    <div className="paper-view-toggles" role="group" aria-label="内容对比">
      {OPTIONS.map(({ key, label }) => {
        const disabled =
          (key === "markdown" && !hasMarkdown) ||
          (key === "note" && !noteAvailable);
        const isActive = active.includes(key);
        return (
          <button
            key={key}
            type="button"
            className={`paper-view-toggle${isActive ? " is-active" : ""}`}
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => toggle(key)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
