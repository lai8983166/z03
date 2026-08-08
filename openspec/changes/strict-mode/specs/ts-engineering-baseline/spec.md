# Spec Delta: ts-engineering-baseline（开 strict）

> 本 change 把 tsconfig 的 `strict: false` 升级为 `strict: true`，并装 `@types/ws`。

## MODIFIED Requirements

### Requirement: TypeScript 编译与类型检查能力
项目 MUST 在根目录提供 `tsconfig.json`（并 MUST 提供 `tsconfig.node.json` 给 server 端），MUST 开启 `allowJs` 使现有 `.js` 与新增 `.ts` 共存，且 MUST 提供 `npm run typecheck`（执行 `tsc --noEmit`，前后端两份 tsconfig 都跑）作为类型检查统一入口。**两份 tsconfig MUST 开启 `strict: true`**——禁止 implicit any、严格 null 检查、strict function types、useUnknownInCatchVariables 等所有 strict 子选项。

#### Scenario: 全新空 TS 文件能通过类型检查
- **WHEN** 开发者在项目中新增一个空 `.ts` 文件并运行 `npm run typecheck`
- **THEN** 命令以退出码 0 成功结束，不产生错误

#### Scenario: 现有 JS 文件不被类型检查阻塞
- **WHEN** 运行 `npm run typecheck` 时项目仍包含大量未迁移的 `.js` 源文件
- **THEN** 类型检查不会因这些 `.js` 文件报错失败（通过 `allowJs` + 不强制 `checkJs` 保证）

#### Scenario: strict 模式全开后通过
- **WHEN** 运行 `npm run typecheck`（tsconfig.json 与 tsconfig.node.json 都开 `strict: true`）
- **THEN** 命令以退出码 0 通过，0 个类型错误（含 implicit any / strict null checks / unknown catch / index signature 等全部子检查）

#### Scenario: strict 错误会被编译期拦截
- **WHEN** 开发者新增代码含有 implicit any 参数（如 `function f(x) { ... }` 未标类型）、或对 possibly null 值未做 narrowing 直接访问属性
- **THEN** `npm run typecheck` 报错并以非 0 退出码结束，阻止此类代码进入主干

### Requirement: 关键第三方库的类型声明齐全
项目 MUST 为所有使用的第三方库安装对应的 `@types/*` 包（或库自带类型）。具体：
- `ws` MUST 安装 `@types/ws` 作为 devDependency
- `serialport` / `exceljs` 已自带类型（无需 @types）
- `tsx` / `typescript` / `vite` / `vitest` 已自带类型

#### Scenario: ws 模块有完整类型
- **WHEN** 在 `ws-bus.ts` / `TcpBridge.ts` / `control.ts` / `server.ts` / `tests/ws-bus.test.ts` 中 `import WebSocket from "ws"`
- **THEN** TS 识别完整类型（无 `Could not find a declaration file for module 'ws'` 错误）

#### Scenario: typecheck 不报缺失类型声明
- **WHEN** 运行 `npm run typecheck`
- **THEN** 0 个 `TS7016: Could not find a declaration file` 错误
