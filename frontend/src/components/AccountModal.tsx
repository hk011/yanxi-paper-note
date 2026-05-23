import {
  CameraOutlined,
  CopyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Form,
  Input,
  Modal,
  Tabs,
  Upload,
  message,
} from "antd";
import type { UploadProps } from "antd";
import { useEffect, useState } from "react";
import { api, buildAuthenticatedUrl } from "../api/client";
import { useAuthStore } from "../store/auth";

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AccountModal({ open, onClose }: AccountModalProps) {
  const profile = useAuthStore((s) => s.profile);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const avatarVersion = useAuthStore((s) => s.avatarVersion);

  const [nameForm] = Form.useForm<{ display_name: string }>();
  const [pwdForm] = Form.useForm<{
    old_password: string;
    new_password: string;
    confirm_password: string;
  }>();
  const [savingName, setSavingName] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetchProfile().catch((e: Error) => message.error(e.message));
  }, [open, fetchProfile]);

  useEffect(() => {
    if (profile) {
      nameForm.setFieldsValue({ display_name: profile.display_name });
    }
  }, [profile, nameForm]);

  const avatarSrc =
    profile?.avatar_url != null
      ? `${buildAuthenticatedUrl(profile.avatar_url)}&v=${avatarVersion}`
      : undefined;

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: "image/jpeg,image/png,image/gif,image/webp",
    beforeUpload: (file) => {
      if (file.size > 8 * 1024 * 1024) {
        message.error("图片不能超过 8MB");
        return Upload.LIST_IGNORE;
      }
      void (async () => {
        setUploadingAvatar(true);
        try {
          const updated = await api.uploadAvatar(file);
          setProfile(updated);
          message.success("头像已更新");
        } catch (e) {
          message.error(e instanceof Error ? e.message : "上传失败");
        } finally {
          setUploadingAvatar(false);
        }
      })();
      return false;
    },
  };

  const onSaveName = async () => {
    const values = await nameForm.validateFields();
    setSavingName(true);
    try {
      const updated = await api.updateProfile(values.display_name.trim());
      setProfile(updated);
      message.success("名称已保存");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingName(false);
    }
  };

  const onChangePassword = async () => {
    const values = await pwdForm.validateFields();
    if (values.new_password !== values.confirm_password) {
      message.error("两次输入的新密码不一致");
      return;
    }
    setSavingPwd(true);
    try {
      await api.changePassword(values.old_password, values.new_password);
      pwdForm.resetFields();
      message.success("密码已修改");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "修改失败");
    } finally {
      setSavingPwd(false);
    }
  };

  const copyAccountId = async () => {
    if (!profile?.account_code) return;
    try {
      await navigator.clipboard.writeText(profile.account_code);
      message.success("账号 ID 已复制");
    } catch {
      message.error("复制失败，请手动复制");
    }
  };

  return (
    <Modal
      title="账户设置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnClose
      className="account-modal"
    >
      <Tabs
        items={[
          {
            key: "profile",
            label: "基本资料",
            children: (
              <div className="account-modal-profile">
                <div className="account-modal-avatar-wrap">
                  <Upload {...uploadProps}>
                    <button
                      type="button"
                      className="account-modal-avatar-btn"
                      disabled={uploadingAvatar}
                    >
                      <Avatar
                        size={72}
                        src={avatarSrc}
                        icon={<UserOutlined />}
                      />
                      <span className="account-modal-avatar-overlay">
                        <CameraOutlined />
                        <span>{uploadingAvatar ? "上传中…" : "更换头像"}</span>
                      </span>
                    </button>
                  </Upload>
                  <p className="account-modal-avatar-hint">支持 JPG / PNG / GIF / WebP，最大 8MB</p>
                </div>

                <div className="account-modal-field readonly">
                  <label>账号 ID</label>
                  <div className="account-modal-account-id">
                    <code>{profile?.account_code || "—"}</code>
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => void copyAccountId()}
                      disabled={!profile?.account_code}
                    >
                      复制
                    </Button>
                  </div>
                  <span className="account-modal-field-hint">注册时随机分配，不可修改</span>
                </div>

                <div className="account-modal-field readonly">
                  <label>登录用户名</label>
                  <span>{profile?.username || "—"}</span>
                </div>

                <Form form={nameForm} layout="vertical" onFinish={() => void onSaveName()}>
                  <Form.Item
                    name="display_name"
                    label="显示名称"
                    rules={[
                      { required: true, message: "请输入显示名称" },
                      { min: 1, max: 64, message: "长度为 1–64 个字符" },
                    ]}
                  >
                    <Input placeholder="在侧栏与界面中显示的名称" maxLength={64} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={savingName}>
                    保存名称
                  </Button>
                </Form>
              </div>
            ),
          },
          {
            key: "security",
            label: "安全设置",
            children: (
              <Form
                form={pwdForm}
                layout="vertical"
                onFinish={() => void onChangePassword()}
                className="account-modal-pwd-form"
              >
                <Form.Item
                  name="old_password"
                  label="当前密码"
                  rules={[{ required: true, message: "请输入当前密码" }]}
                >
                  <Input.Password placeholder="当前密码" autoComplete="current-password" />
                </Form.Item>
                <Form.Item
                  name="new_password"
                  label="新密码"
                  rules={[
                    { required: true, message: "请输入新密码" },
                    { min: 4, message: "至少 4 位" },
                  ]}
                >
                  <Input.Password placeholder="新密码（至少 4 位）" autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                  name="confirm_password"
                  label="确认新密码"
                  rules={[{ required: true, message: "请再次输入新密码" }]}
                >
                  <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={savingPwd}>
                  修改密码
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
