/** 判断是否为 AI 生成的配图路径（可安全删除） */
export function isGenFigurePath(raw: string): boolean {
  const clean = raw.replace(/^\.?\/?/, "").replace(/^\/api\/papers\/\d+\/files\//, "");
  return /^images\/gen\/gen_\d+\.png$/i.test(clean) || /^assets\/gen_\d+\.png$/i.test(clean);
}

export function normalizeFigureRelPath(raw: string): string {
  return raw
    .trim()
    .replace(/^\/api\/papers\/\d+\/files\//, "")
    .replace(/^\.?\/?/, "");
}
