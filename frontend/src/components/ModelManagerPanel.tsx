import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, List, Popconfirm, message } from "antd";
import { api, type UserCustomModel } from "../api/client";

interface Props {
  onChanged?: () => void;
  mcpSearchAvailable?: boolean;
}

export default function ModelManagerPanel({
  onChanged,
  mcpSearchAvailable = false,
}: Props) {
  const [items, setItems] = useState<UserCustomModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{
    name: string;
    api_url: string;
    api_key: string;
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.listCustomModels());
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载模型失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    const values = await form.validateFields();
    setCreating(true);
    try {
      await api.createCustomModel({
        name: values.name.trim(),
        api_url: values.api_url.trim(),
        api_key: values.api_key.trim(),
      });
      form.resetFields();
      message.success("模型已添加");
      await load();
      onChanged?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id: number) => {
    try {
      await api.deleteCustomModel(id);
      message.success("已删除");
      await load();
      onChanged?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="model-manager-panel">
      <p className="model-manager-hint">
        添加 OpenAI 兼容接口（如 DeepSeek、OpenAI 等）。API Key 仅保存在服务端，不会返回给浏览器。
        {mcpSearchAvailable ? (
          <>
            已在服务端配置千帆 MCP 联网搜索，自定义模型可用于<strong>笔记生成</strong>、
            <strong>论文问答</strong>与<strong>小节润色</strong>（通过 web_search 工具）。
          </>
        ) : (
          <>
            未配置 <code>web_search_mcp_server_key</code> 时，自定义模型<strong>无法联网</strong>；
            配置后可用于笔记生成、问答与润色。
          </>
        )}
      </p>

      <Form form={form} layout="vertical" onFinish={() => void onCreate()}>
        <Form.Item
          name="name"
          label="模型名"
          rules={[{ required: true, message: "请输入模型名" }]}
          extra="与 API 请求中的 model 字段一致，例如 deepseek-chat"
        >
          <Input placeholder="deepseek-chat" maxLength={128} />
        </Form.Item>
        <Form.Item
          name="api_url"
          label="API URL"
          rules={[{ required: true, message: "请输入 API URL" }]}
          extra="OpenAI 兼容 Base URL，例如 https://api.deepseek.com 或 https://api.deepseek.com/v1"
        >
          <Input placeholder="https://api.deepseek.com/v1" maxLength={512} />
        </Form.Item>
        <Form.Item
          name="api_key"
          label="API Key"
          rules={[{ required: true, message: "请输入 API Key" }]}
        >
          <Input.Password placeholder="sk-..." maxLength={512} />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={creating}>
          添加模型
        </Button>
      </Form>

      <List
        className="model-manager-list"
        loading={loading}
        header="已添加的自定义模型"
        locale={{ emptyText: "暂无自定义模型" }}
        dataSource={items}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Popconfirm
                key="delete"
                title="确定删除该模型？"
                onConfirm={() => void onDelete(item.id)}
              >
                <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={item.name}
              description={
                <>
                  {item.api_url}
                  {mcpSearchAvailable ? (
                    <span className="model-switcher-mcp-search-tag"> · 可联网（MCP）</span>
                  ) : (
                    <span className="model-manager-no-search"> · 需配置 MCP 后联网</span>
                  )}
                </>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}
