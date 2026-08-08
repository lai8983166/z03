# Design: 3b-4 control 模块 + 修参数名 bug

## Context

handleJsonControlMessage/handleControlCommand 是 server.ts 的消息路由（~150 行）。3b-3a/3b-3b 用 replace_all 改 data 调用时，引入**参数名冲突 bug**：函数参数 `data`（消息对象）与 data 模块实例 `data` 同名，函数内 `data.showSaveFileDialog` 实际访问消息对象 → 前端发消息崩。

本 change 提取 control 为独立模块，**参数重命名 `data` → `msg`**，data 方法走 opts.data——bug 随之修复。

## Goals / Non-Goals

**Goals**
- 提取 control.ts：createControl(opts) 含 handleJsonControlMessage/handleControlCommand。
- 修参数名 bug（msg + opts.data）。
- control 完整类型（无 @ts-nocheck）。
- 行为逐字等价。

**Non-Goals**
- 不迁 turntable（3b-5，通过 opts.turntable 接口）。
- 不迁 binarized* 状态（留 server.ts，通过 opts.binarized getter/setter）。
- 不整体提取 WS connection handler（留 server.ts，只改 JSON 分支调 control.*）。
- 不补单测（路由分发，靠人工触发）。

## Decisions

### D1. createControl 工厂（opts 注入所有依赖）
control 不直接访问 server.ts 全局。opts 含 wsBus/data(DataController)/video(VideoController)/turntable({send,setPort})/binarized({6 getter/setter})。createControl 返回 handleJsonControlMessage(msg,ws)/handleControlCommand(msg)。

### D2. 参数重命名 data → msg（修 bug，本 change 关键）
handleJsonControlMessage(data, ws) → handleJsonControlMessage(msg, ws)；handleControlCommand(data) → handleControlCommand(msg)。函数内：
- 消息字段（type/saveType/row/header/threshold/invert/action/filePath/port/data 等）→ `msg.`
- data 模块方法（showSaveFileDialog/startSaving*/appendSjcj*/setHeixiaziHeader/appendHeixiaziRow/stopSaving*）→ `opts.data.`
- video 方法（startBinarized/stopBinarized/restartBinarized）→ `opts.video.`
- turntable（send/setPort）→ `opts.turntable.`
- binarized 状态 → `opts.binarized.`
逐 case 审查，确保不漏。

### D3. binarized* 状态留 server.ts（通过 opts.binarized getter/setter）
isStreamingBinarizedVideo/binarizedThreshold/binarizedInvert 留 server.ts（video 的 getter 3b-2 已读它们）。control 通过 opts.binarized.getInvert/setInvert/getThreshold/setThreshold/getIsStreaming/setIsStreaming 访问。避免改 video（3b-2）+ 打破 control↔video 循环。

### D4. turntable 留 server.ts（通过 opts.turntable 接口）
initTurntableSerial/sendToTurntableSerial/turntableSerial/TURNTABLE_SERIAL_PORT 留 server.ts（3b-5 提取）。control 的 SET_TURNTABLE_PORT 通过 opts.turntable.setPort(port)（server.ts 封装关旧+设新+init 逻辑）；SEND_TO_BRIDGE2 通过 opts.turntable.send(buf)（sendToTurntableSerial）。

### D5. control 创建顺序（在 data/video 后）
control.opts 用 data/video，所以 control 在 data/video 后创建。turntable/binarized 通过闭包 getter/setter（server.ts 状态，control 创建时已在作用域）。

### D6. 无单测（路由分发）
control 是 switch case 分发（调 opts 方法），无可独立单测的纯函数。靠 tsx 启动 + **人工触发前端消息对照**（关键：验证 bug 修复 + 路由正确）。

## Risks / Trade-offs

- **参数重命名遗漏** → 逐 case 审查（msg vs opts.data）；人工触发各 case 对照。
- **opts 注入遗漏** → grep 复核 control.ts 无 server.ts 全局引用（turntableSerial/binarizedInvert 等）。
- **bug 修复验证** → 人工触发 REQUEST_SAVE_PATH（修复前崩，修复后弹对话框 + 开始保存）。
- **turntable.setPort 封装** → 封装 SET_TURNTABLE_PORT 逻辑（关旧+设新+init），逐字搬迁自原 case 体。
- **无单测** → 路由靠人工触发。

## Migration Plan

- 顺序：创建 control.ts（含 createControl + 两函数逐字搬迁 + 参数 msg）→ tsconfig include → server.ts 改（createControl + 移函数 + connection handler JSON 分支调 control.* + turntable.setPort 封装）→ typecheck + test + tsx → commit。
- 回滚：`git revert`。
