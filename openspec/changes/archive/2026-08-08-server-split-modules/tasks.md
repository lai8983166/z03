# Tasks: 3b-1 ws-bus 传输基础设施

> 全局约定：每 change 提交一次 git；测试 mock；不改 HTML/CSS/JS 样式；遗留代码不接入。本 change 关键纪律：**broadcast 逻辑逐字等价，30+ 调用点机械改造，connection handler 业务不动**。

## 1. 创建 ws-bus.ts（skill: eric-backend）

- [ ] 1.1 新建 `ws-bus.ts`：导出 `WsBus` interface（wss/wssImg/clients/imgClients/broadcast/broadcastImg/broadcastBinary/close）；导出纯函数 `broadcastTo(clients, message)` / `broadcastBinaryTo(clients, buffer)`；导出 `createWsBus(port, portImg)` 工厂（创建两个 WebSocketServer + 空 Set + broadcast 偏应用 + close）。**完整 TS 类型，无 @ts-nocheck**。逻辑与原 server.ts line 129-145/539-546 逐字等价。
- [ ] 1.2 `tsconfig.node.json` 的 include 加 `ws-bus.ts`
- [ ] 1.3 `npx tsc -p tsconfig.node.json --noEmit` 通过（ws-bus.ts 类型干净）

## 2. server.ts 改用 wsBus（skill: eric-backend）

- [ ] 2.1 server.ts 顶部 import `{ createWsBus }` from `"./ws-bus"`；在 cfg 加载后 `const wsBus = createWsBus(WS_PORT, WS_PORT_IMG);`
- [ ] 2.2 移除 server.ts 内联：`wss`/`wssImg` 创建（原 line 82-93）、`clients`/`imgClients` 声明（原 line 95, 147）、`broadcast`/`broadcastImg`/`broadcastBinary` 定义（原 line 129-145, 539-546）。改为用 wsBus 的对应字段。
- [ ] 2.3 connection handler（wss.on/wssImg.on）保留，但内部 `clients.add/delete` → `wsBus.clients.add/delete`；`imgClients` 同理；`wss`/`wssImg` 引用改 `wsBus.wss`/`wsBus.wssImg`。**业务 message 分支逐字不动**。
- [ ] 2.4 全部 `broadcast(` → `wsBus.broadcast(`；`broadcastImg(` → `wsBus.broadcastImg(`；`broadcastBinary(` → `wsBus.broadcastBinary(`（grep 复核：`grep -nE "[^.]broadcast\(" server.ts` 应无残留）
- [ ] 2.5 SIGINT handler 的 `wss.close(); wssImg.close();` → `wsBus.close();`
- [ ] 2.6 server.ts 仍保留顶部 `// @ts-nocheck`（其他部分未拆，本 change 不收尾 server.ts 类型）

## 3. ws-bus 单测（skill: eric-writing-tests）

- [ ] 3.1 `tests/ws-bus.test.ts`：测 `broadcastTo`/`broadcastBinaryTo` 纯函数——构造 mock WebSocket（`{ readyState: WebSocket.OPEN, send: vi.fn() }`）填入 Set，调 broadcastTo，断言 send 被调用且参数正确；构造 CLOSED 客户端断言不调；broadcastBinaryTo 断言发原始 Buffer 不 JSON.stringify。**不调 createWsBus（避免绑端口）**，全程零真实网络。
- [ ] 3.2 `npm test` 通过（50 旧 + ws-bus 新测试全绿）

## 4. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 4.1 `npm run typecheck` 通过（ws-bus.ts 无 @ts-nocheck 被检查；server.ts 仍 @ts-nocheck）
- [ ] 4.2 `npm test` 通过
- [ ] 4.3 `npm run dev:server`（tsx）启动，WS 监听日志（8081/8082）与 change 3 一致
- [ ] 4.4 grep 复核：server.ts 无残留裸 `broadcast(`/`broadcastImg(`/`broadcastBinary(`；ws-bus.ts 无 `@ts-nocheck`
- [ ] 4.5 浏览器人工对照：连 WS，触发 broadcast 事件（如 bridge ready / 串口回复），前端收到与重构前一致
- [ ] 4.6 复核约束：`index.html`/`style.css`/JS 样式未动；遗留代码（ffmpeg）调用关系未变；connection handler 业务逻辑逐字未动
- [ ] 4.7 eric-review 自查（重点：broadcast 是否漏改、ws-bus 类型是否完整、clients 引用一致性、业务是否被无意改动）
- [ ] 4.8 `git commit`（本 change 一次提交）
