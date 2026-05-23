import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Input, Tabs, message } from "antd";
import { useAuthStore } from "../store/auth";
import BrandMark from "../components/BrandMark";

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (values: { username: string; password: string }, isRegister: boolean) => {
    setLoading(true);
    try {
      if (isRegister) await register(values.username, values.password);
      else await login(values.username, values.password);
      message.success(isRegister ? "注册成功" : "登录成功");
      navigate("/");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <Form layout="vertical" onFinish={(v) => onSubmit(v, false)}>
      <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2 }]}>
        <Input placeholder="请输入用户名" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, min: 4 }]}>
        <Input.Password placeholder="请输入密码" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>
        登录
      </Button>
    </Form>
  );

  const registerForm = (
    <Form layout="vertical" onFinish={(v) => onSubmit(v, true)}>
      <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2 }]}>
        <Input placeholder="请输入用户名" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, min: 4 }]}>
        <Input.Password placeholder="至少 4 位" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>
        注册并登录
      </Button>
    </Form>
  );

  return (
    <div className="login-page">
      <div className="login-page-brand">
        <BrandMark showText logoSize={56} />
        <p className="login-page-tagline">论文解读</p>
      </div>
      <Card style={{ width: 400 }} className="login-page-card">
        <Tabs
          items={[
            { key: "login", label: "登录", children: form },
            { key: "register", label: "注册", children: registerForm },
          ]}
        />
      </Card>
    </div>
  );
}
