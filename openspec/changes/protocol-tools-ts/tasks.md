# Tasks: protocol-tools-ts（CommandBuilder + BinaryTableHelper 升级 TS）

> 全局约定（见 `openspec/config.yaml`）：每个 change 一个 git commit；测试一律 mock；不改 HTML/CSS/JS 样式；遗留代码保留且不接入。本 change 把最后两个 .js 协议层工具 rename 为 .ts + 完整 TS 类型。设计依据：design.md D1-D8。安全网：tests/protocol/{command-builder,binary-table-helper}.test.ts 已覆盖纯逻辑。

## 1. 准备与盘点（skill: eric-quality-control）

- [x] 1.1 `npm run typecheck` 确认基线 0 错
- [x] 1.2 `npm test` 确认基线 61/61
- [x] 1.3 grep 复核 `js/CommandBuilder.js` / `js/BinaryTableHelper.js` 的所有引用（前端 JS + 测试），形成清单

## 2. CommandBuilder.ts（skill: eric-backend）

- [x] 2.1 `git mv js/CommandBuilder.js js/CommandBuilder.ts`
- [x] 2.2 加类型：`buildPacket(cmdByte1: number, cmdByte2: number, payload: Uint8Array | number[] = []): Uint8Array`、`bufferToHex(buffer: Uint8Array): string`
- [x] 2.3 JSDoc 保留作为文档（`@param` 描述部分），但 `@param {type}` 移除（TS 已声明）
- [x] 2.4 typecheck 复核（CommandBuilder 单独通过）

## 3. BinaryTableHelper.ts（skill: eric-backend）

- [x] 3.1 `git mv js/BinaryTableHelper.js js/BinaryTableHelper.ts`
- [x] 3.2 `DataType` 加 `as const`（D2），导出 type `DataTypeValue = (typeof DataType)[keyof typeof DataType]`
- [x] 3.3 `@typedef MetaItem` → TS `interface MetaItem`（含 index/row/col/name/type/scale/byteWidth/offset 字段；type 用 `DataTypeValue | string`）
- [x] 3.4 BinaryTableHelper class 字段显式声明：`metaData: Map<number, MetaItem>`、`buffer: ArrayBuffer | null`、`view: DataView | null`、`isLittleEndian: boolean`、`totalBytes: number`
- [x] 3.5 BinaryTableHelper 16 个方法签名加类型（DOM 方法标 `string` for tableId，`number` for row/col/index，DOM 元素返回类型用 narrowing 或 `HTMLTableElement | null`）
- [x] 3.6 PacketManager class 字段：`packets: Record<string, BinaryTableHelper>`、`protocols: string[]`；方法：`init(csvBaseUrl: string): Promise<void>`、`get(protocolName: string): BinaryTableHelper | null`（D6）
- [x] 3.7 catch (e) 块用 `(e as Error).message` 或 `e instanceof Error ? e.message : String(e)`（D8 风险）
- [x] 3.8 typecheck 复核：可能暴露 DOM 类型错（D3）—— 逐个加 narrowing 或断言

## 4. tsconfig + import 路径更新（skill: eric-javascript）

- [x] 4.1 `tsconfig.json` include 更新：`js/CommandBuilder.js` / `js/BinaryTableHelper.js` 改为 `.ts`（或保持通配，看现状）
- [x] 4.2 更新前端 JS 5 处 import 路径（去 `.js` 后缀）：js/Command.js、js/ImageUpload.js、js/Telemeter.js、js/YC.js、main.js
- [x] 4.3 更新测试 2 处 import 路径（去 `.js` 后缀）：tests/protocol/command-builder.test.ts、tests/protocol/binary-table-helper.test.ts
- [x] 4.4 grep 复核全项目无 `BinaryTableHelper.js` / `CommandBuilder.js` 残留引用

## 5. 验证（skill: eric-quality-control）

- [x] 5.1 `npm run typecheck` 通过（strict 全开，0 错）
- [x] 5.2 `npm test` 通过（61/61 全绿）
- [x] 5.3 grep 复核：4 个协议层文件无 `@ts-nocheck`；新增 `@ts-expect-error` 仅在有真实第三方/DOM 类型限制时（目标 0 或接近 0）
- [x] 5.4 grep 复核：`as any` 全项目 0 处
- [x] 5.5 `git diff` 复核：可执行代码逐字不变（仅类型标注 + rename + import 路径）
- [x] 5.6 复核约束：index.html / style.css / JS 样式代码未动；前端 JS 文件只改 import 路径；测试断言未改

## 6. eric-review + 提交（skill: eric-review）

- [x] 6.1 eric-review 自查（重点：DOM narrowing 是否破坏运行时假设、rename 是否完整、import 路径全项目清理、interface 是否如实描述运行时 union）
- [x] 6.2 `git commit`（含 rename + 类型 + import 路径 + tsconfig）
- [x] 6.3 `git push`
