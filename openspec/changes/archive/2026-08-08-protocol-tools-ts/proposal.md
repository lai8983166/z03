## Why

`js/CommandBuilder.js`（74 行）与 `js/BinaryTableHelper.js`（787 行）是项目最后两个仍是 `.js` + JSDoc 的协议层文件。bridge-impl-types / strict-mode 后它们虽通过 typecheck（`allowJs` + `checkJs: false`），但 JSDoc 类型不被 TS 工具链原生支持（hover/重构/跳转体验弱），且 strict 全开后 JSDoc 推断与 TS 严格模式边界模糊。本 change 把它们 rename 为 `.ts` 并加完整 TS 类型，统一全后端 + 协议层工具的 TS 化。

## What Changes

- rename `js/CommandBuilder.js` → `js/CommandBuilder.ts`：`buildPacket` / `bufferToHex` 加参数与返回值类型
- rename `js/BinaryTableHelper.js` → `js/BinaryTableHelper.ts`：
  - `DataType` 常量对象保留（运行时枚举），可加 `as const` 让字面量类型精确
  - `@typedef MetaItem` → TS `interface MetaItem`
  - `BinaryTableHelper` class：13 个字段 + 16 个方法签名加类型（含 DOM 方法 readCell/updateAllFromTable/updateAllToTable/getAllNames/getSpecInfo）
  - `PacketManager` class：字段 + 3 个方法签名加类型
- 更新 `tsconfig.json` 的 include：`js/CommandBuilder.js` / `js/BinaryTableHelper.js` → `.ts`
- 更新所有 import 路径（去 `.js` 后缀让 vite/tsx 自动解析）：
  - 前端 JS：`js/Command.js`、`js/ImageUpload.js`、`js/Telemeter.js`、`js/YC.js`、`main.js`
  - 测试：`tests/protocol/command-builder.test.ts`、`tests/protocol/binary-table-helper.test.ts`
- **行为逐字不变**：仅加类型、rename、改 import 路径；DOM 方法的 `document.getElementById` 等访问加必要 narrowing（`if (!table) return`），不改运行时逻辑

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `protocol-regression-tests`: 把"协议层 JSDoc 类型注解"requirement 中关于 `js/CommandBuilder.js` / `js/BinaryTableHelper.js` 维持 JSDoc 的描述，更新为升级到完整 TS 类型；并新增"两个工具文件 rename 为 .ts，import 路径去 .js 后缀"scenario

## Impact

- **rename**：2 个文件
- **代码**：2 个文件加 TS 类型；5 个前端 JS + 2 个测试的 import 路径更新（仅路径，逻辑不动）
- **配置**：`tsconfig.json` include 更新（去掉 `.js`，加 `.ts`，或保持通配）
- **构建/CI**：`npm run typecheck` 仍 0 错；`npm test` 仍 61/61 全绿
- **运行时**：零影响（TS 类型编译擦除；import 路径在 vite/tsx 下行为等价）
- **样式/HTML**：零改动
- **遗留**：BinaryTableHelper 的 DOM 方法（readCell/updateAllToTable 等）保留并 TS 化，调用关系不变；测试不覆盖 DOM 方法（约束：测试不依赖 DOM）
