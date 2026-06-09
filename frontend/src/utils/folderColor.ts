import type { FolderNode } from "../api/client";

export interface FolderTheme {
  dot: string;
  from: string;
  to: string;
  text: string;
}

/** 独立色系数量：顶层文件夹按顺序分配，超出后循环复用 */
export const FOLDER_FAMILY_COUNT = 10;

/** 每个色系内子文件夹深度档位（0=顶层，越深档位越高） */
const DEPTH_LEVELS = 4;

/** 10 种可辨识色系，子级共享同族不同深浅 */
const COLOR_FAMILIES: FolderTheme[][] = [
  // 紫
  [
    { dot: "#5e5ce6", from: "#ede9fe", to: "#ddd6fe", text: "#4338ca" },
    { dot: "#4f46e5", from: "#e0e7ff", to: "#c7d2fe", text: "#3730a3" },
    { dot: "#4338ca", from: "#c7d2fe", to: "#a5b4fc", text: "#312e81" },
    { dot: "#3730a3", from: "#a5b4fc", to: "#818cf8", text: "#1e1b4b" },
  ],
  // 蓝
  [
    { dot: "#2563eb", from: "#dbeafe", to: "#bfdbfe", text: "#1d4ed8" },
    { dot: "#1d4ed8", from: "#bfdbfe", to: "#93c5fd", text: "#1e40af" },
    { dot: "#1e40af", from: "#93c5fd", to: "#60a5fa", text: "#1e3a8a" },
    { dot: "#1e3a8a", from: "#60a5fa", to: "#3b82f6", text: "#172554" },
  ],
  // 青
  [
    { dot: "#0891b2", from: "#cffafe", to: "#a5f3fc", text: "#0e7490" },
    { dot: "#0e7490", from: "#a5f3fc", to: "#67e8f9", text: "#155e75" },
    { dot: "#155e75", from: "#67e8f9", to: "#22d3ee", text: "#164e63" },
    { dot: "#164e63", from: "#22d3ee", to: "#06b6d4", text: "#083344" },
  ],
  // 绿
  [
    { dot: "#16a34a", from: "#dcfce7", to: "#bbf7d0", text: "#15803d" },
    { dot: "#15803d", from: "#bbf7d0", to: "#86efac", text: "#166534" },
    { dot: "#166534", from: "#86efac", to: "#4ade80", text: "#14532d" },
    { dot: "#14532d", from: "#4ade80", to: "#22c55e", text: "#052e16" },
  ],
  // 琥珀
  [
    { dot: "#d97706", from: "#fef3c7", to: "#fde68a", text: "#b45309" },
    { dot: "#b45309", from: "#fde68a", to: "#fcd34d", text: "#92400e" },
    { dot: "#92400e", from: "#fcd34d", to: "#fbbf24", text: "#78350f" },
    { dot: "#78350f", from: "#fbbf24", to: "#f59e0b", text: "#451a03" },
  ],
  // 玫红
  [
    { dot: "#db2777", from: "#fce7f3", to: "#fbcfe8", text: "#be185d" },
    { dot: "#be185d", from: "#fbcfe8", to: "#f9a8d4", text: "#9d174d" },
    { dot: "#9d174d", from: "#f9a8d4", to: "#f472b6", text: "#831843" },
    { dot: "#831843", from: "#f472b6", to: "#ec4899", text: "#500724" },
  ],
  // 红
  [
    { dot: "#dc2626", from: "#fee2e2", to: "#fecaca", text: "#b91c1c" },
    { dot: "#b91c1c", from: "#fecaca", to: "#fca5a5", text: "#991b1b" },
    { dot: "#991b1b", from: "#fca5a5", to: "#f87171", text: "#7f1d1d" },
    { dot: "#7f1d1d", from: "#f87171", to: "#ef4444", text: "#450a0a" },
  ],
  // 紫罗兰
  [
    { dot: "#7c3aed", from: "#f3e8ff", to: "#e9d5ff", text: "#6d28d9" },
    { dot: "#6d28d9", from: "#e9d5ff", to: "#d8b4fe", text: "#5b21b6" },
    { dot: "#5b21b6", from: "#d8b4fe", to: "#c084fc", text: "#4c1d95" },
    { dot: "#4c1d95", from: "#c084fc", to: "#a855f7", text: "#3b0764" },
  ],
  // 橙
  [
    { dot: "#ea580c", from: "#ffedd5", to: "#fed7aa", text: "#c2410c" },
    { dot: "#c2410c", from: "#fed7aa", to: "#fdba74", text: "#9a3412" },
    { dot: "#9a3412", from: "#fdba74", to: "#fb923c", text: "#7c2d12" },
    { dot: "#7c2d12", from: "#fb923c", to: "#f97316", text: "#431407" },
  ],
  // 石灰
  [
    { dot: "#65a30d", from: "#ecfccb", to: "#d9f99d", text: "#4d7c0f" },
    { dot: "#4d7c0f", from: "#d9f99d", to: "#bef264", text: "#3f6212" },
    { dot: "#3f6212", from: "#bef264", to: "#a3e635", text: "#365314" },
    { dot: "#365314", from: "#a3e635", to: "#84cc16", text: "#1a2e05" },
  ],
];

export const UNCATEGORIZED_THEME: FolderTheme = {
  dot: "#9ca3af",
  from: "#f9fafb",
  to: "#f3f4f6",
  text: "#4b5563",
};

interface FolderColorMeta {
  rootIndex: number;
  depth: number;
}

let metaCacheKey = "";
let metaCache = new Map<number, FolderColorMeta>();

function cacheKey(folders: FolderNode[]): string {
  const parts: string[] = [];
  const walk = (nodes: FolderNode[]) => {
    for (const n of nodes) {
      parts.push(`${n.id}:${n.parent_id}`);
      walk(n.children);
    }
  };
  walk(folders);
  return parts.join("|");
}

function buildFolderMeta(folders: FolderNode[]): Map<number, FolderColorMeta> {
  const key = cacheKey(folders);
  if (key === metaCacheKey) return metaCache;

  const map = new Map<number, FolderColorMeta>();
  folders.forEach((root, rootIndex) => {
    const walk = (node: FolderNode, depth: number) => {
      map.set(node.id, {
        rootIndex: rootIndex % FOLDER_FAMILY_COUNT,
        depth,
      });
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(root, 0);
  });

  metaCacheKey = key;
  metaCache = map;
  return map;
}

export function getFolderTheme(
  folderId: number,
  folders?: FolderNode[]
): FolderTheme {
  if (!folders?.length) {
    const family = COLOR_FAMILIES[Math.abs(folderId) % FOLDER_FAMILY_COUNT];
    return family[0];
  }
  const meta = buildFolderMeta(folders).get(folderId);
  if (!meta) {
    const family = COLOR_FAMILIES[Math.abs(folderId) % FOLDER_FAMILY_COUNT];
    return family[0];
  }
  const family = COLOR_FAMILIES[meta.rootIndex];
  const level = Math.min(meta.depth, DEPTH_LEVELS - 1);
  return family[level];
}

export function getPaperCoverTheme(
  paper: { id: number; folder_ids?: number[] },
  folders?: FolderNode[]
): FolderTheme {
  const folderId = paper.folder_ids?.[0];
  if (folderId == null) return UNCATEGORIZED_THEME;
  return getFolderTheme(folderId, folders);
}
