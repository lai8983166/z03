## Context

tsconfig `strict: true` 是 TS 的"全包"严格开关，等价于：
- `noImplicitAny`（参数/变量禁止隐式 any）
- `noImplicitThis`（this 禁止隐式 any）
- `strictNullChecks`（null/undefined 不能赋给非可空类型）
- `strictFunctionTypes`、`strictBindCallApply`、`strictPropertyInitialization`
- `alwaysStrict`（emit `"use strict"`）
- `useUnknownInCatchVariables`（catch (e) 的 e 是 unknown）

当前 `strict: false` 让这些都豁免。临时跑 strict 评估：后端 tsconfig 28 错 + 前端 tsconfig 19 错 = ~47 错。

错类型分布（去掉装 @types/ws 后）：
- ~30 implicit any 参数（最多：config.ts 验证函数的 obj/key/type/path 参数）
- 1 null check（data.ts _psWorker）
- 1 index signature（server.ts mimeTypes）
- 2 unknown（config.ts catch）
- 1 overload（TcpBridge.ts socket.on message）
- ~12 测试代码错（主要 ws 模块）

约束（openspec/config.yaml）：测试 mock / 不改样式 / 遗留代码保留。

## Goals / Non-Goals

**Goals:**
- tsconfig.json 与 tsconfig.node.json 开 `strict: true`
- 装 `@types/ws` 修复 ws 模块 implicit any（5 处自动消失）
- 修复剩余 ~42 错，使 `npm run typecheck` 0 错
- 测试代码同样通过 strict（不改断言，只加类型）
- 运行时行为零变更

**Non-Goals:**
- **不**改业务逻辑、协议解析、字节布局、命令表数值
- **不**改前端 `js/CommandBuilder.js` / `js/BinaryTableHelper.js`（仍是 .js + JSDoc，本 change 不动）
- **不**重构架构（不加新 interface 抽象，除非必要修复 index signature）
- **不**清理已有的 `// @ts-expect-error`（本 change 不引入新的逃生舱，但已有的不动）
- **不**强制修改测试断言（只修测试代码类型，不改 WHEN/THEN）

## Decisions

### D1: 装包前置——`@types/ws`

**决定**：先 `pnpm add -D @types/ws`，再开 strict。

**理由**：5 处错都是同一原因（ws 模块缺类型声明），装包一次解决，避免逐处加 `// @ts-expect-error` 或 `as` 断言。@types/ws 是 DefinitelyTyped 维护的成熟包，与项目已用的 ws@8 兼容。

### D2: implicit any 参数优先精确类型，避免 `any`

**决定**：对每个 implicit any 参数，优先找出实际运行时类型并显式标注；避免用 `any` 兜底。

**示例**：
- `config.ts` 验证函数的 `obj: Record<string, unknown>`、`key: string`、`type: "number" | "string" | "boolean" | "object"`、`path: string`
- `server.ts` WS connection 的 `ws: WebSocket`（来自 ws 库）
- `TcpBridge.ts` 错误回调的 `err: Error`
- 测试里的 mock 参数按实际 mock 类型

**理由**：开 strict 的目的就是消除 any，用 `any` 兜底违背初衷。

**例外**：极个别第三方库类型不全或情形复杂时，允许 `unknown` + narrowing，或 `// @ts-expect-error` 注明原因（D6）。

### D3: catch 块按 `useUnknownInCatchVariables` 处理

**决定**：catch (e) 的 e 默认 `unknown`，访问 `.message` 等属性前 MUST 用类型守卫 `e instanceof Error` 或断言 `as Error`。

**理由**：JS 中 throw 可以抛任何值（不限于 Error），`unknown` + narrowing 是 type-safe 的标准做法。优先 `instanceof Error` 守卫，能确定时再用 `as Error` 断言。

### D4: null check 用 narrowing 优先于 `!` 断言

**决定**：对 `possibly null` 错（如 `data.ts:250 _psWorker`），优先用 `if (x) { ... }` narrowing；只有当运行时已通过其他检查保证非 null（如 `isConnected` 检查后访问 `client`）才用 `!` 断言。

**理由**：narrowing 表达"如果到这行则非 null"的语义；`!` 是"我相信它非 null"，前者更安全。3c 已有先例（`socket!.address()` 在 listening 回调里，运行时必非 null）。

### D5: index signature 用 `Record<string, T>` 替换字面量对象

**决定**：`server.ts:42` 的 `mimeTypes` 用方括号访问时报"index signature 缺失"，改为 `const mimeTypes: Record<string, string> = {...}`。

**理由**：原代码 `const mimeTypes = {".html": "...", ...}` 推断为具体字面量类型，方括号访问需要 index signature。`Record<string, string>` 是标准做法。

### D6: 逃生舱使用规则

**决定**：本 change **不主动引入** `// @ts-expect-error` 或 `as any`。仅在以下情形允许并 MUST 注明原因：
- 第三方库（如 `@types/ws` 之外的库）类型缺失
- TS 内置 API 类型与运行时行为不一致（罕见）
- 修复成本远超价值（如深层 generics 推断失败）

**理由**：strict 的价值在 type safety，滥用逃生舱抵消收益。已有 0 个 `@ts-expect-error`（3c 后状态），目标是保持 0 或接近 0。

### D7: 测试代码类型修复——不改断言

**决定**：测试代码（`tests/**/*.ts`）的 strict 错只修类型（参数标注、mock 类型、ws import），**MUST NOT** 改 WHEN/THEN 断言逻辑。

**理由**：测试断言是行为契约，改断言等于改需求。

### D8: 单 commit

**决定**：本 change 全部改动一个 commit（含装包 + 配置 + 代码修）。回滚用 `git revert`。

## Risks / Trade-offs

- **[修类型时无意改逻辑]** → 缓解：每修一批跑一次 `npm test`（61 测试），任何断言失败立即定位；eric-review 自查 git diff 去掉类型后逐字一致
- **[strict 暴露真实 bug]** → 缓解：这正是 strict 的价值；如发现真实 bug，记录在 design 里单独说明，不在本 change 修（避免范围蔓延），开 follow-up change
- **[装 @types/ws 与 ws@8 不兼容]** → 缓解：@types/ws 是 ws 官方配套类型，DefinitelyTyped 长期维护；装包后跑 test 验证
- **[overload 不匹配（TcpBridge.ts:143）]** → 缓解：可能是 dgram.Socket message 事件签名；按实际签名标 `rinfo: dgram.RemoteInfo` 或保留为参数推断
- **[测试 mock 失配]** → 缓解：测试代码可能因 strict 暴露 mock 类型问题；只修测试代码类型，不改 mock 行为
- **[遗留代码（ffmpeg/UdpBridge 未启用路径）暴露大量错]** → 缓解：遗留代码同样收类型（不接入不断开），如果某些路径类型化成本过高，临时用 `// @ts-expect-error: 遗留路径，保留以备未来启用` 注明
