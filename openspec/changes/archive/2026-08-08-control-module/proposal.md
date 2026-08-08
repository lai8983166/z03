# Proposal: 3b-4 提取 control 模块 + 修参数名冲突 bug

## 背景：发现并修复 3b-3a/3b-3b 引入的 bug

3b-3a/3b-3b 用 replace_all 把 `startSavingVideo(` → `data.startSavingVideo(` 等迁移到 data 模块时，**没注意 handleJsonControlMessage/handleControlCommand 的参数名也叫 `data`**（消息对象）。结果函数内部 `data.showSaveFileDialog(...)`/`data.startSavingVideo(...)` 实际是在**消息对象上调用 data 模块方法**——参数名冲突，运行时 `undefined is not a function`。

tsx 启动不触发（无前端消息）、typecheck（server.ts @ts-nocheck）不报、测试不覆盖 control——所以 3b-3a/3b-3b 没暴露。但**前端一发 REQUEST_SAVE_PATH / CONTROL_CMD / SAVE_B_FRAME_ROW 等就会崩**。

本 change（3b-4）提取 control 为独立模块时，**参数重命名为 `msg`**（消息对象），data 模块方法通过 opts 注入的 `data` 实例调用——bug 随之修复。

## Why

1. **修 bug**（关键）：control 提取后参数 `data` → `msg`，函数内 `data.showSaveFileDialog` 等改为 opts.data 实例调用，消除参数名冲突。
2. server.ts 减 handleJsonControlMessage/handleControlCommand（~150 行）。
3. control 独立类型（无 @ts-nocheck）。

## What Changes

### 1. 新建 `control.ts`（完整 TS 类型，无 @ts-nocheck）
导出 `createControl(opts)` 工厂，返回 `{ handleJsonControlMessage(msg, ws), handleControlCommand(msg) }`。

**opts 依赖注入**（control 不直接访问 server.ts 全局）：
- `wsBus`：broadcast
- `data`：DataController（showSaveFileDialog/startSaving*/stopSaving*/appendSjcj*/setHeixiaziHeader/appendHeixiaziRow）
- `video`：VideoController（startBinarizedVideoStream/stopBinarizedVideoStream/restartBinarizedVideoStream）
- `turntable`：`{ send(buf), setPort(port) }`（封装 sendToTurntableSerial + SET_TURNTABLE_PORT 逻辑，留 server.ts 实现）
- `binarized`：`{ getInvert(), setInvert(v), getThreshold(), setThreshold(v), getIsStreaming(), setIsStreaming(v) }`（binarized* 状态留 server.ts，control 通过 getter/setter）

**参数重命名**（修 bug）：`handleJsonControlMessage(data, ws)` → `handleJsonControlMessage(msg, ws)`；`handleControlCommand(data)` → `handleControlCommand(msg)`。函数内消息字段（`data.type`/`data.saveType`/`data.row` 等）改 `msg.`；data 模块方法（`data.showSaveFileDialog` 等）改 `opts.data.showSaveFileDialog`。

逐字搬迁 handleJsonControlMessage/handleControlCommand 的 switch 逻辑（case 分支不变，只改变量名）。

### 2. server.ts 改用 control
- 顶部 `import { createControl } from "./control";`
- 创建 control（在 data/video 后，因 opts 用 data/video；turntable/binarized 通过闭包 getter/setter）：
  ```ts
  const control = createControl({
    wsBus, data, video,
    turntable: { send: sendToTurntableSerial, setPort: (port) => { /* 关旧+设新+init */ } },
    binarized: {
      getInvert: () => binarizedInvert, setInvert: (v) => { binarizedInvert = v; },
      getThreshold: () => binarizedThreshold, setThreshold: (v) => { binarizedThreshold = v; },
      getIsStreaming: () => isStreamingBinarizedVideo, setIsStreaming: (v) => { isStreamingBinarizedVideo = v; },
    },
  });
  ```
- 移除 server.ts 的 handleJsonControlMessage/handleControlCommand 函数
- WS connection handler 的 message JSON 分支：`handleJsonControlMessage(data, ws)` → `control.handleJsonControlMessage(data, ws)`（注意 connection handler 的 `data` 是 JSON.parse 的消息对象，传 control 作 msg 参数——无冲突，因 connection handler 的 data 是局部变量，control 内部参数 msg）

### 3. 测试：无单测（同前几个 control/路由 change）
control 是消息路由（switch case），依赖 data/video/turntable/binarized/wsBus。路由逻辑本身是分发（调 opts 方法），无可独立单测的纯函数。靠 tsx 启动 + **人工触发前端消息对照**（这次尤其重要——验证 bug 修复：前端发 REQUEST_SAVE_PATH/CONTROL_CMD 不再崩）。

### 不在本 change 范围
- ❌ turntable 整体提取（留 3b-5，本 change 只通过 opts.turntable 接口调用）
- ❌ binarized* 状态迁移（留 server.ts，control 通过 getter/setter）
- ❌ WS connection handler 整体提取（留 server.ts，只改其中的 handleJsonControlMessage 调用为 control.*）
- ❌ server.ts 整体移除 @ts-nocheck

## Capabilities

### New Capabilities
- `control-router`：消息路由模块——handleJsonControlMessage（JSON 控制消息：ping/SET_TURNTABLE_PORT/REQUEST_SAVE_PATH/SAVE_*_ROW/HEIXIAZI_*/BINARIZED_PARAMS/CONTROL_CMD）+ handleControlCommand（action 命令：START/STOP_SAVE_*/START/STOP_BINARIZED_STREAM/SEND_TO_BRIDGE2）。依赖通过 opts 注入。

### Modified Capabilities
- 无。

## Impact

### 新增文件
- `control.ts`（完整类型，无 @ts-nocheck）
- `openspec/specs/control-router/spec.md`

### 修改文件
- `server.ts`：移除 handleJsonControlMessage/handleControlCommand（~150 行）；创建 control 实例（注入 opts）；connection handler 的 JSON 分支调 control.handleJsonControlMessage；turntable.setPort 封装 SET_TURNTABLE_PORT 逻辑
- `tsconfig.node.json`：include 加 `control.ts`

### 不变
- 所有路由行为（case 分支逻辑逐字搬迁）
- turntable/binarized* 状态管理（留 server.ts）
- `index.html`/`style.css`/前端 JS
- 61 测试仍绿

### 验收
- `npm run typecheck` 通过（control.ts 无 @ts-nocheck）
- `npm test` 通过（61 旧）
- `npm run dev:server`（tsx）启动正常
- **人工触发前端消息对照**（关键：验证 bug 修复——前端发 REQUEST_SAVE_PATH 弹对话框 + 开始保存；CONTROL_CMD 的 START_SAVE_*；SAVE_B/A_FRAME_ROW 数据接收；BINARIZED_PARAMS 重启流；SET_TURNTABLE_PORT 切串口；SEND_TO_BRIDGE2 转发）
- git 提交一次

### 风险与对策
- **参数重命名遗漏**（msg vs data）→ 逐 case 审查（消息字段改 msg.，data 方法改 opts.data.）；tsx + 人工触发对照。
- **opts 注入遗漏**（turntable/binarized）→ grep 复核 control.ts 无 server.ts 全局引用。
- **bug 修复验证** → 人工触发 REQUEST_SAVE_PATH（之前会崩，修复后正常）。
- **无单测** → control 路由靠人工触发验证。
