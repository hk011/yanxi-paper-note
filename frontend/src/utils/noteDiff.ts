export type DiffLineKind = "same" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export type HunkDecision = "pending" | "accept" | "reject";

export interface DiffHunk {
  id: string;
  lines: DiffLine[];
  removeCount: number;
  addCount: number;
}

/** 简单行级 diff，用于笔记版本对比 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: "same", text: oldLines[i], oldLineNo: oldNo, newLineNo: newNo });
      i++;
      j++;
      oldNo++;
      newNo++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ kind: "remove", text: oldLines[i], oldLineNo: oldNo });
      i++;
      oldNo++;
    } else {
      result.push({ kind: "add", text: newLines[j], newLineNo: newNo });
      j++;
      newNo++;
    }
  }
  while (i < m) {
    result.push({ kind: "remove", text: oldLines[i], oldLineNo: oldNo });
    i++;
    oldNo++;
  }
  while (j < n) {
    result.push({ kind: "add", text: newLines[j], newLineNo: newNo });
    j++;
    newNo++;
  }
  return result;
}

export function diffStats(lines: DiffLine[]) {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    if (line.kind === "remove") removed++;
  }
  return { added, removed };
}

/** 将 diff 行聚合成可独立接受/拒绝的修改块 */
export function groupDiffIntoHunks(lines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let buffer: DiffLine[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    hunks.push({
      id: `hunk-${hunks.length}`,
      lines: [...buffer],
      removeCount: buffer.filter((l) => l.kind === "remove").length,
      addCount: buffer.filter((l) => l.kind === "add").length,
    });
    buffer = [];
  };

  for (const line of lines) {
    if (line.kind === "same") {
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return hunks;
}

/** 根据每块决策合成最终笔记 */
export function applyHunkDecisions(
  diffLines: DiffLine[],
  decisions: Record<string, HunkDecision>,
  defaultDecision: HunkDecision = "accept"
): string {
  const hunks = groupDiffIntoHunks(diffLines);
  const output: string[] = [];
  let hunkIdx = 0;
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];
    if (line.kind === "same") {
      output.push(line.text);
      i++;
      continue;
    }

    const start = i;
    while (i < diffLines.length && diffLines[i].kind !== "same") i++;
    const hunkLines = diffLines.slice(start, i);
    const hunk = hunks[hunkIdx++];
    const decision = decisions[hunk?.id ?? ""] ?? defaultDecision;

    if (decision === "accept") {
      for (const l of hunkLines) {
        if (l.kind === "add") output.push(l.text);
      }
    } else {
      for (const l of hunkLines) {
        if (l.kind === "remove") output.push(l.text);
      }
    }
  }

  return output.join("\n");
}

export function hunkDecisionSummary(
  hunks: DiffHunk[],
  decisions: Record<string, HunkDecision>
) {
  let accept = 0;
  let reject = 0;
  let pending = 0;
  for (const h of hunks) {
    const d = decisions[h.id] ?? "pending";
    if (d === "accept") accept++;
    else if (d === "reject") reject++;
    else pending++;
  }
  return { accept, reject, pending, total: hunks.length };
}
