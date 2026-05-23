export type SectionRunStatus = "pending" | "running" | "done" | "error";

export type NotePipelinePhase = "outline" | "draft" | "final" | "";

export interface NoteSectionDef {
  id: string;
  title: string;
}

export const NOTE_SECTIONS: NoteSectionDef[] = [
  { id: "basic_info", title: "一、论文基础信息" },
  { id: "background", title: "二、背景、动机与结果" },
  { id: "methods", title: "三、核心方法" },
  { id: "experiments", title: "四、实验结果" },
  { id: "conclusion", title: "五、总结与展望" },
  { id: "reading", title: "六、扩展阅读" },
];

export function createInitialSectionProgress(): Record<string, SectionRunStatus> {
  return Object.fromEntries(
    NOTE_SECTIONS.map((section) => [section.id, "pending" as SectionRunStatus])
  );
}
