## Context

| 模块 | 行数 | case 数 | mock 难度 |
|---|---|---|---|
| control.ts | 194 | 14（handleControlCommand）+ 9（handleJsonControlMessage）= 23 | 低（工厂模式，opts 是参数） |
| DataHandler.ts | 282 | 38（handleRS485） | 中（需 vi.mock 多个 import） |

约束（openspec/config.yaml）：测试一律 mock，不接触真实端口/IP/串口/子进程/DOM。

## Goals / Non-Goals

**Goals:**
- control.ts 路由测试覆盖所有 case（含 default、空值边界、分支）
- DataHandler.ts 路由测试覆盖主要 case（含 data[0] 分支）
- 全 mock，不接触外部依赖
- typecheck 0 错 / 所有现有测试仍全绿

**Non-Goals:**
- 不测 handler 内部逻辑（如 data.startSavingVideo 怎么写文件——那是 data 模块单测的职责）
- 不测 38 个 case 的每一个（选主要的；data[0] 分支选关键的）
- 不测 DOM 方法（约束）
- 不改业务代码

## Decisions

### D1: control 测试用工厂 mock

**决定**：control.ts 是 `createControl(opts)` 工厂，opts 含 data/video/turntable/binarized/wsBus。测试构造 mock opts（每个方法 `vi.fn()`），调 `handleControlCommand(msg)` / `handleJsonControlMessage(msg, mockWs)`，验证 mock 被以预期参数调用。

**示例**：
```typescript
const mockOpts = {
  wsBus: { broadcast: vi.fn(), broadcastImg: vi.fn() },
  data: { startSavingVideo: vi.fn(), stopSavingVideo: vi.fn(), /* ... */ },
  video: { startBinarizedVideoStream: vi.fn(), /* ... */ },
  turntable: { send: vi.fn(), setPort: vi.fn() },
  binarized: { getThreshold: vi.fn(() => 50), setThreshold: vi.fn(), /* ... */ },
};
const { handleControlCommand } = createControl(mockOpts as unknown as ControlOptions);
handleControlCommand({ action: "START_SAVE_VIDEO", filePath: "/tmp/x.dat" });
expect(mockOpts.data.startSavingVideo).toHaveBeenCalledWith("/tmp/x.dat");
```

### D2: DataHandler 测试用 vi.mock 替换 import

**决定**：DataHandler.ts import 大量 handler（来自 Command/ImageUpload/CodeUpload/DataRouter/Telemeter）。用 `vi.mock("./Command", () => ({ handle_X: vi.fn(), ... }))` 替换。测试调 `handleRS485(flag, name, data)`，验证对应 mock 被调用。

**示例**：
```typescript
vi.mock("./Command", () => ({
  handle_FJYJZ_2000H: vi.fn(),
  handle_Shut_0004H: vi.fn(),
  // ... 所有 import 的 handler
}));
import { handleRS485 } from "./DataHandler";
import * as Cmd from "./Command";

handleRS485(0, "FJYJZ_2000H", Buffer.from([]));
expect(Cmd.handle_FJYJZ_2000H).toHaveBeenCalled();
```

### D3: case 覆盖策略

**决定**：
- control.ts：全 case 覆盖（含 default 和边界，如 SEND_TO_BRIDGE2 无 data 不调、SET_TURNTABLE_PORT 空 port 走 ws.send error、BINARIZED_PARAMS needRestart 分支）
- DataHandler.ts：选主要 case（约 20-25 个），含 data[0] 分支的 case 测各分支；default case 测一次

### D4: 测试文件位置

**决定**：
- `tests/control.test.ts`（顶层，control.ts 是后端业务模块不是协议层）
- `tests/data-handler.test.ts`（顶层，DataHandler 是前端业务路由不是协议解析）

**不放在 tests/protocol/**：因为 tests/protocol/ 是协议层（TcpBridge/UdpBridge/CommandBuilder/BinaryTableHelper），control/DataHandler 是业务路由。

### D5: mock 粒度

**决定**：mock 整个 opts（control）/ 整个 import 模块（DataHandler），不 partial mock。验证调用次数 + 参数。

### D6: 单 commit

## Risks / Trade-offs

- **[vi.mock hoisting 行为]** → 缓解：vi.mock 在文件顶部，引用工厂返回的对象通过 import 之后；用 `vi.importActual` 如需保留部分实现
- **[DataHandler 38 case 测试覆盖不全]** → 缓解：D3 选主要的；剩余 case 标 TODO 留后续
- **[mock 参数类型与实际不符]** → 缓解：用 `as unknown as ControlOptions` cast，运行时 mock 行为正确
- **[测试数量爆发]** → 缓解：每 case 1-2 个 test（不每个分支都测）；总控在 ~60 个以内
