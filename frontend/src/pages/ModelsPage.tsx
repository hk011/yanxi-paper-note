import { useCallback, useEffect, useState } from "react";
import { Card, List, message } from "antd";
import { api, type ModelOption, type PaperSummary } from "../api/client";
import ModelManagerPanel from "../components/ModelManagerPanel";
import WorkspaceShell from "../components/WorkspaceShell";

export default function ModelsPage() {
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [builtinModels, setBuiltinModels] = useState<ModelOption[]>([]);
  const [mcpSearchAvailable, setMcpSearchAvailable] = useState(false);

  const loadPapers = useCallback(async () => {
    try {
      setPapers(await api.listPapers());
    } catch {
      /* 侧栏任务列表加载失败时不阻塞页面 */
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const res = await api.listModels();
      setBuiltinModels(res.models.filter((m) => m.source === "builtin"));
      setMcpSearchAvailable(Boolean(res.mcp_search_available));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载模型列表失败");
    }
  }, []);

  useEffect(() => {
    void loadPapers();
    void loadModels();
  }, [loadPapers, loadModels]);

  return (
    <WorkspaceShell
      title="模型管理"
      subtitle="配置 OpenAI 兼容 API，用于笔记生成与论文问答"
      papers={papers.map((p) => ({ id: p.id, title: p.title, status: p.status }))}
    >
      <div className="models-page">
        {builtinModels.length > 0 ? (
          <Card size="small" title="内置模型" className="models-page-builtin">
            <List
              size="small"
              dataSource={builtinModels}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={item.label}
                    description="火山方舟 · 支持联网搜索与可选 AI 配图；小节「添加配图」用于笔记内插图"
                  />
                </List.Item>
              )}
            />
          </Card>
        ) : null}

        <Card size="small" title="自定义模型" className="models-page-custom">
          <ModelManagerPanel
            onChanged={loadModels}
            mcpSearchAvailable={mcpSearchAvailable}
          />
        </Card>
      </div>
    </WorkspaceShell>
  );
}
