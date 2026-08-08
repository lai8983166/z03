# Tasks: setup-ts-baseline

> 全局约定（见 `openspec/config.yaml`）：每个 change 完成后提交一次 git；测试一律 mock；不改 HTML/CSS/JS 样式；遗留代码保留且不接入。下方每组标注主导 skill，冲突时以用户硬约束为准。

## 1. 配置统一（skill: eric-backend）

- [x]1.1 grep `server.js`，穷举所有运行时硬编码常量（IP / 端口 / 串口 / 波特率 / RTSP / ffmpeg / 分辨率 / 帧字节 / 数据目录等），形成清单
- [x]1.2 设计 `config.json` 结构（分组：`http` / `ws` / `bridges[3]` / `turntable` / `video` / `imageUpload` / `dataDir`），把 1.1 的值校准进去——以 `server.js` 真实值为准（`192.168.0.20` / `192.168.0.170` / `30041,30042,30040` / `COM7` / `115200` / `rtsp://192.168.10.1:8554/live` / `128×128` 等）
- [x] 1.3 新建 `config.js`（CJS + JSDoc 类型）：`loadConfig(path)` + `validateConfig`，含文件缺失 / 关键字段缺失的明确报错
- [x]1.4 改 `server.js`：`const cfg = loadConfig('./config.json')`，用 `cfg.*` 替换全部硬编码常量；**逻辑逐字不动**，遗留（ffmpeg 等）代码也只换常量读取方式
- [x]1.5 创建 `config.example.json`（结构同 `config.json`，真实联调值）
- [x]1.6 更新 `.gitignore`：放行 `config.example.json`，确认 `config.json` 仍被忽略

## 2. TypeScript 工程基线（skill: eric-javascript）

- [x]2.1 `pnpm add -D typescript @types/node`
- [x]2.2 创建 `tsconfig.json`（`allowJs:true` / `checkJs:false` / `strict:false` / `noEmit:true`）+ `tsconfig.node.json`（`extends` 根，node 环境）
- [x]2.3 `package.json` 加 `"typecheck": "tsc --noEmit"`
- [x]2.4 验证：`npm run typecheck` 退出码 0

## 3. Vite 前端（skill: eric-javascript）

- [x]3.1 确认 `server.js` 静态服务范围 + 前端所有 `fetch`/相对资源路径（决定 HTTP 代理清单）
- [x]3.2 `pnpm add -D vite`
- [x]3.3 创建 `vite.config.ts`：以 `index.html` 为入口；`server.proxy` 把 `/csv`（及 3.1 确认的其他静态路径）代理到 `http://localhost:8080`；**不配 WS 代理**（前端 WS 直连 `8081/8082`，见 design D1）
- [x]3.4 `package.json` 加 `"dev": "vite"`、`"build": "vite build"`
- [x]3.5 验证：`npm run dev` 起前端，浏览器加载正常，CSV 表格加载、WS 连接行为与重构前一致

## 4. Vitest 测试骨架（skill: eric-quality-control + eric-writing-tests）

- [x]4.1 `pnpm add -D vitest`
- [x]4.2 创建 `vitest.config.ts`（`environment: 'node'`，`include: ['tests/**/*.test.ts']`）
- [x]4.3 写 `tests/smoke.test.ts`：测 `loadConfig` 的文件缺失 + 关键字段缺失 → 抛预期错误；**全程 mock 文件系统，绝不连真实网络/串口/子进程**
- [x]4.4 `package.json` 加 `"test": "vitest run"`
- [x]4.5 验证：`npm test` 通过；确认全程无真实网络 IO / 串口 / 子进程

## 5. 后端 dev 脚本

- [x]5.1 `package.json` 加 `"dev:server": "node server.js"`

## 6. 验收与提交（skill: eric-quality-control + eric-review）

- [x]6.1 `npm run typecheck` / `npm test` 全通过
- [x]6.2 启动 `npm run dev:server` + `npm run dev`，浏览器人工对照重构前：页面、标签、表格、WS、UDP 桥接逐字一致
- [x]6.3 grep 复核：`server.js` 内不再有 `192.168` / `COM7` / `115200` / `30041` 等业务硬编码（仅 config 读取）
- [x]6.4 `git diff` 复核：`index.html`、`style.css` 未改动；`js/` 下文件未改动（含样式代码）
- [x]6.5 复核：遗留代码（ffmpeg 等）调用关系未变，无新增/断开调用
- [x]6.6 eric-review 自查清单（implementation degradation / 边界违规 / 过度抽象 / 样式改动 / 遗留代码接入 / 测试是否真 mock）
- [x]6.7 `git commit`（本 change 一次提交）
