import { useCallback, useEffect, useRef, useState } from "react";
import { CommentOutlined } from "@ant-design/icons";

const STORAGE_KEY = "yanxi:chat-fab-position";
const FAB_SIZE = 52;
const DRAG_THRESHOLD = 6;

interface Position {
  x: number;
  y: number;
}

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Position;
    if (typeof p.x === "number" && typeof p.y === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function savePosition(p: Position) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function defaultPosition(): Position {
  return {
    x: Math.max(16, window.innerWidth - FAB_SIZE - 28),
    y: Math.max(16, window.innerHeight - FAB_SIZE - 28),
  };
}

function clampPosition(p: Position): Position {
  const maxX = window.innerWidth - FAB_SIZE - 12;
  const maxY = window.innerHeight - FAB_SIZE - 12;
  return {
    x: Math.min(Math.max(12, p.x), maxX),
    y: Math.min(Math.max(12, p.y), maxY),
  };
}

interface Props {
  onClick: () => void;
  title?: string;
}

export default function DraggableChatFab({ onClick, title = "展开 AI 助手" }: Props) {
  const [pos, setPos] = useState<Position>(() => loadPosition() ?? defaultPosition());
  const dragRef = useRef({
    dragging: false,
    moved: false,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    const onResize = () => setPos((p) => clampPosition(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      dragging: true,
      moved: false,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragRef.current.moved = true;
    }
    const next = clampPosition({
      x: e.clientX - dragRef.current.offsetX,
      y: e.clientY - dragRef.current.offsetY,
    });
    setPos(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const final = clampPosition({
        x: e.clientX - dragRef.current.offsetX,
        y: e.clientY - dragRef.current.offsetY,
      });
      setPos(final);
      savePosition(final);
      if (!dragRef.current.moved) {
        onClick();
      }
    },
    [onClick]
  );

  return (
    <button
      type="button"
      className="chat-fab-draggable"
      style={{ left: pos.x, top: pos.y }}
      title={title}
      aria-label={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="chat-fab-draggable-ring" aria-hidden />
      <CommentOutlined />
    </button>
  );
}
