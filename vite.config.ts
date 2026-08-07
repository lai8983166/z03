import { defineConfig } from "vite";

// Vite dev server 配置。
//
// 关键决策（见 openspec/changes/setup-ts-baseline/design.md D1/D2）：
// - 前端 WebSocket 客户端（js/Client.js、js/ImageUploadClient.js）用
//   `window.location.hostname` 连 8081/8082。Vite dev 下 hostname=localhost，
//   自动直连后端 wss（后端 wss 未校验 origin），因此**不配 WS 代理**，
//   两个 WS 客户端文件零改动。
// - 前端 `fetch("./csv/...")` 等静态资源原本由后端 8080 的静态服务提供。
//   这里把 /csv 代理到后端，保持加载行为不变。
export default defineConfig({
  server: {
    proxy: {
      "/csv": "http://localhost:8080",
    },
  },
});
