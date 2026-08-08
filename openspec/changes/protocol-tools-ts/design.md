## Context

`js/CommandBuilder.js` + `js/BinaryTableHelper.js` 是 protocol-layer-ts change 加过 JSDoc 注解的两个协议层工具。bridge-impl-types 把 TcpBridge/Udp.ts 升级到完整 TS 类型后，这两个 .js 文件成为最后的"JSDoc 模式"区域。strict-mode 开了 strict: true 后，allowJs + checkJs:false 仍让它们豁免严格检查——TS 工具链体验打折。

文件规模：
- `CommandBuilder.js`：74 行，2 个导出函数（buildPacket / bufferToHex），已有完整 JSDoc
- `BinaryTableHelper.js`：787 行，含 DataType 常量、MetaItem typedef、BinaryTableHelper class（16 方法，6 个依赖 DOM）、PacketManager class（3 方法，依赖 fetch）

引用关系：
- 前端 JS 5 处 import（js/Command.js、js/ImageUpload.js、js/Telemeter.js、js/YC.js、main.js）使用 `./BinaryTableHelper.js` 或 `./js/BinaryTableHelper.js`
- 测试 2 处 import（tests/protocol/command-builder.test.ts、tests/protocol/binary-table-helper.test.ts）

约束（openspec/config.yaml）：
- 测试一律 mock
- 不改 index.html / style.css / JS 样式代码（import 路径修改不属于"样式代码"）
- 遗留代码保留并 TS 化

## Goals / Non-Goals

**Goals:**
- 两个文件 rename 为 `.ts`，JSDoc 转完整 TS 类型（interface + 字段 + 方法签名）
- 更新所有 import 路径（去 `.js` 后缀）
- tsconfig include 反映新文件名
- DOM 方法保留并加 narrowing（不改运行时检查逻辑）
- typecheck 0 错 / test 61/61 全绿

**Non-Goals:**
- **不**改任何业务逻辑、字节布局、CSV 解析、scale/endian 计算
- **不**重构 class 结构、不提取子模块、不拆 PacketManager
- **不**改前端 JS 文件的样式代码（仅改 import 路径）
- **不**改测试断言（WHEN/THEN 不变；只调整 import 路径）
- **不**动其他 .js 文件（js/Command.js 等仍是 .js）
- **不**加 strict 逃生舱（@ts-expect-error），除非有真实的第三方库/DOM 类型限制

## Decisions

### D1: rename + 转类型，而非保留 JSDoc

**决定**：rename `.js` → `.ts`，JSDoc 转 TS interface/类型标注。

**理由**：项目目标是全后端 + 协议层 TS 化（已 11 个 change 推进）；保留 JSDoc 等于停滞。TS 工具链（IDE hover、rename refactor、跳转）体验远好于 JSDoc。

**替代方案**：开 `checkJs: true` 让 JSDoc 也参与 strict 检查——风险：JSDoc 推断与 TS 严格模式有边界 case，且工具链体验仍弱于原生 TS。否决。

### D2: DataType 用 `as const` + 字面量 union 类型

**决定**：原代码 `const DataType = { UINT8: "UINT8", ... }` 加 `as const`，让 TS 推断为字面量类型；MetaItem.type 用 `(typeof DataType)[keyof typeof DataType] | string` 联合，如实描述"未识别时存原始字符串"的现有行为。

**理由**：原 JSDoc 描述"DataType 的某个值，或未识别的原始类型字符串"——这是 union 类型。`as const` 让 TS 精确推断枚举值，避免宽松 string。

**替代方案**：改成 TS `enum DataType`——风险：enum 引入运行时对象 + 编译产物变化，且原代码用 `DataType.UINT8` 等访问形式，enum 也支持。但 enum 的运行时 emit 与 const 对象不同（enum 是双向映射）。为最小化运行时影响，保留 const + as const。

### D3: DOM 方法用 `document.getElementById` 返回的 union + narrowing

**决定**：DOM 方法（readCell/updateAllFromTable 等）保留原逻辑，TS strict 下 `document.getElementById(tableId)` 返回 `HTMLElement | null`，访问 `.rows` 必须 narrowing。原代码已经有 `if (!table || ...) return` 检查（如 line 429-430、540-541、613-614），TS 应能 narrow。如果某些路径没有检查，加 `as HTMLTableElement` 断言或补 `if` 守卫（不改运行时行为，因为运行时已经是这样工作）。

**理由**：DOM 方法不在测试范围（约束），但 strict 要求类型安全。运行时已经在访问 .rows 前隐式假设 table 是 HTMLTableElement，TS 类型化只是显式化这个假设。

### D4: import 路径——去 `.js` 后缀

**决定**：所有 `import ... from "./BinaryTableHelper.js"` 改为 `import ... from "./BinaryTableHelper"`（去后缀）。

**理由**：
- vite 默认 `resolve.extensions` 含 `.ts`，无后缀 import 会自动找到 `.ts` 文件
- tsconfig `moduleResolution: "Bundler"` 支持无后缀 import
- 显式 `.js` 后缀的 import 在 rename 为 `.ts` 后会找不到文件
- 改为 `.ts` 后缀也可以，但混用 `.js`/`.ts` 后缀看起来怪；无后缀最干净

**替代方案**：保留 `.js` 后缀，依赖 vite 别名重定向——复杂且不标准。否决。

### D5: 测试 import 同步更新，断言不动

**决定**：测试文件的 import 路径同样去 `.js` 后缀。**MUST NOT** 改 WHEN/THEN 断言（与 strict-mode D7 一致）。

**理由**：测试断言是行为契约。

### D6: PacketManager 字段类型——`Record<string, BinaryTableHelper>` + protocols 数组

**决定**：`packets: Record<string, BinaryTableHelper>`、`protocols: string[]`、`init(csvBaseUrl: string): Promise<void>`、`get(protocolName: string): BinaryTableHelper | null`（原代码 `return null` 时返回 null）。

**理由**：原 JSDoc `@returns {BinaryTableHelper}` 不准确（运行时可能返回 null），TS 类型如实标注。

### D7: DOM 类型 lib

**决定**：tsconfig 不显式配 `lib`，依赖 `target: ES2022` 默认含 DOM。如果 strict 暴露 DOM 错（如 `document` 未定义），加 `"lib": ["ES2022", "DOM", "DOM.Iterable"]` 显式声明。

**理由**：项目实际依赖 DOM（前端 JS 用 document、fetch、FileReader 等），需要 DOM 类型。当前测试在 node 环境跑（vitest environment: node），测试代码不调 DOM 方法，所以 DOM 类型仅在 BinaryTableHelper.ts 内部使用——TS 编译时检查，不影响运行时。

### D8: 单 commit，可回滚

**决定**：本 change 全部改动一个 commit。

## Risks / Trade-offs

- **[rename 后前端运行时找不到模块]** → 缓解：vite resolve.extensions 默认含 .ts；测试通过即说明 vite 解析正确；frontend JS 文件改动后人工对照浏览器加载
- **[DOM 类型 strict 暴露大量错]** → 缓解：DOM 方法 6 个，每个加 narrowing 或断言；如果某个方法类型化成本过高，临时 `// @ts-expect-error: DOM 方法，类型化成本过高，保留以备未来`（但目标是不引入）
- **[BinaryTableHelper 的 buffer 字段类型复杂]** → 缓解：`buffer: ArrayBuffer | null`、`view: DataView | null`，访问前用 `if (!this.view) return` 守卫（原代码已有）
- **[parseLocData 的 type 字段可能是字符串或 DataType 枚举]** → 缓解：D2 用 union 类型 `DataTypeValue | string`，如实描述运行时行为
- **[PacketManager.get 返回 null 与 JSDoc 不符]** → 缓解：D6 改返回类型为 `BinaryTableHelper | null`，调用方需要 narrow（前端 JS 调用方不参与 typecheck，但加注释说明）
- **[strict 模式下 catch (e) 的 e 是 unknown]** → 缓解：用 `(e as Error).message` 或 `e instanceof Error ? e.message : String(e)`，与 strict-mode D3 一致
- **[前端 JS 改 import 后破坏运行]** → 缓解：vite 配置不变，去后缀的 import 在 vite 下行为等价；npm test 通过证明 import 解析正确（测试也用同一 import）
