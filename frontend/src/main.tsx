import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import { XProvider } from "@ant-design/x";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1677FF",
          colorBgLayout: "#FFFFFF",
          colorText: "#1F2329",
          colorTextSecondary: "#86909C",
          borderRadius: 8,
          fontFamily:
            'Inter, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          fontSize: 14,
        },
      }}
    >
      <XProvider>
        <App />
      </XProvider>
    </ConfigProvider>
  </React.StrictMode>
);
