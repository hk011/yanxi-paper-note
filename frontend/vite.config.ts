import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    // 绑定 0.0.0.0 时需显式指定 HMR，否则 localhost 访问热更新会失效
    hmr: {
      host: "localhost",
      port: 5173,
    },
    // 中文路径 / 部分 macOS 环境下原生 fs watch 不稳定，开启轮询兜底
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
    allowedHosts: ["all", ".trycloudflare.com", ".top"],
  },
});
