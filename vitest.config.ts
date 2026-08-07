import { defineConfig } from "vitest/config";

// Vitest 配置。
// environment: node —— 本项目的测试针对后端/纯逻辑（协议解析、配置校验等），
// 不需要浏览器 DOM。smoke 测试全程通过 mock / 纯函数隔离，绝不连接真实
// 网络、串口或子进程（遵循 setup-ts-baseline 的"测试隔离"spec）。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
