# Tasks: strict-mode（tsconfig 开 strict + 修 ~47 错）

> 全局约定（见 `openspec/config.yaml`）：每个 change 一个 git commit；测试一律 mock；不改 HTML/CSS/JS 样式；遗留代码保留且不接入。本 change 把 tsconfig 的 strict: false 升级为 strict: true，装 @types/ws，修 ~47 个 strict 错。设计依据：design.md D1-D8。

## 1. 准备（skill: eric-javascript）

- [x] 1.1 `pnpm add -D @types/ws`，验证 `package.json` + `pnpm-lock.yaml` 更新
- [x] 1.2 跑 `npm run typecheck`（strict 未开）确认 @types/ws 装上后 0 错（5 处 ws 错自动消失）
- [x] 1.3 跑 `npm test` 确认基线 61/61（@types/ws 装上不应影响测试）

## 2. 开 strict（skill: eric-quality-control）

- [x] 2.1 `tsconfig.json` 的 `"strict": false` 改为 `"strict": true`
- [x] 2.2 `tsconfig.node.json` 不必改（extends 根，自动继承）
- [x] 2.3 跑 `npm run typecheck` 收集所有 strict 错（预期 ~42 处），按文件分组

## 3. 修 config.ts（skill: eric-backend）

- [x] 3.1 line 37 `(c)` 参数加类型（验证函数，按实际签名）
- [x] 3.2 line 44-46 / 52-54 `(obj, key, type, path)` 参数加类型（验证函数；obj 用 `Record<string, unknown>`、key/path 用 string、type 用 union 字面量）
- [x] 3.3 line 79 `(b, i)` 参数加类型（数组遍历，按数组类型 + number）
- [x] 3.4 line 120 `(configPath)` 参数加 string 类型
- [x] 3.5 line 130 / 136 catch 块 unknown：用 `e instanceof Error` narrowing 或 `as Error` 断言（D3）

## 4. 修 server.ts（skill: eric-backend）

- [x] 4.1 line 42 `mimeTypes` 改 `Record<string, string>` 类型（D5）
- [x] 4.2 line 67 / 102 WS connection `(ws)` 参数加 `WebSocket` 类型（import type 自 ws）
- [x] 4.3 line 73 / 125 `(message)` 参数加类型（WS message 事件，按 ws 库签名）
- [x] 4.4 line 94 / 228 `(err)` 参数加 `NodeJS.ErrnoException | Error` 或 `Error` 类型

## 5. 修 TcpBridge.ts（skill: eric-backend）

- [x] 5.1 line 143 overload：检查 `socket.on('message', ...)` 回调签名，按 dgram.Socket 标准签名 `(msg: Buffer, rinfo: dgram.RemoteInfo)` 加 rinfo 类型
- [x] 5.2 line 216 / 428 `(err)` 参数加 `Error` 类型

## 6. 修 data.ts / control.ts / 其他后端（skill: eric-backend）

- [x] 6.1 `data.ts:250` `_psWorker` possibly null：用 `if (_psWorker) {...}` narrowing 或 `!` 断言（D4，优先 narrowing）
- [x] 6.2 control.ts / turntable.ts / bridges.ts / js/Udp.ts / ws-bus.ts 复跑 typecheck 后看是否有新错（装 @types/ws 后预期大幅减少）

## 7. 修 tests/（skill: eric-writing-tests）

- [x] 7.1 `tests/ws-bus.test.ts` 等 ws 相关测试：装 @types/ws 后预期自动解决；若仍有错则按 mock 实际类型修
- [x] 7.2 其他测试 strict 错：只加类型标注，**不改 WHEN/THEN 断言**（D7）
- [x] 7.3 跑 `npm test` 验证 61/61 仍全绿

## 8. 全量验证（skill: eric-quality-control）

- [x] 8.1 `npm run typecheck` 通过（strict: true，前后端 0 错）
- [x] 8.2 `npm test` 通过（61 测试全绿）
- [x] 8.3 grep 复核 `@ts-expect-error` / `@ts-ignore`：新增数（本 change 引入的）MUST ≤ 极少数 + 每处注明原因；保留 3c 后状态（接近 0）
- [x] 8.4 grep 复核 `as any`：MUST 为 0（D2 禁止 any 兜底）
- [x] 8.5 `git diff` 复核：去掉类型标注后可执行代码逐字一致；遗留代码（ffmpeg/UdpBridge 未启用路径）保留并收类型
- [x] 8.6 复核约束：index.html / style.css / JS 样式未动；测试断言未改

## 9. eric-review + 提交（skill: eric-review）

- [x] 9.1 eric-review 自查（重点：strict 错修复是否引入运行时副作用、是否有 `as any` 兜底、catch narrowing 是否正确、index signature 是否破坏其他访问）
- [x] 9.2 `git commit`（本 change 一次提交，含 package.json + pnpm-lock.yaml + tsconfig + 代码改动）
- [x] 9.3 `git push`
