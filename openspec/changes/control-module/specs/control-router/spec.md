# Spec Delta: control-router

> 本 change 新增 control 模块（消息路由）+ 修复 3b-3a/3b-3b 引入的参数名冲突 bug（handleJsonControlMessage/handleControlCommand 参数 `data` 与 data 模块实例冲突，前端发消息会崩）。

## ADDED Requirements

### Requirement: control 模块导出 createControl 工厂
项目 MUST 提供 `control.ts`，导出 `createControl(opts)` 工厂，返回 `{ handleJsonControlMessage(msg, ws), handleControlCommand(msg) }`。opts MUST 含 `wsBus`/`data`(DataController)/`video`(VideoController)/`turntable`({send,setPort})/`binarized`({getInvert,setInvert,getThreshold,setThreshold,getIsStreaming,setIsStreaming})。

#### Scenario: createControl 返回路由接口
- **WHEN** 调用 `createControl({...})`
- **THEN** 返回对象含 `handleJsonControlMessage(msg, ws)` 与 `handleControlCommand(msg)` 两个函数

### Requirement: 参数名 msg（修复 3b-3a/3b-3b 的冲突 bug）
`handleJsonControlMessage` 与 `handleControlCommand` 的第一个参数 MUST 命名为 `msg`（消息对象），MUST NOT 命名为 `data`（避免与 data 模块实例冲突）。函数内消息字段（type/saveType/row/header/threshold/invert/action/filePath/port/data 等）MUST 通过 `msg.` 访问；data 模块方法（showSaveFileDialog/startSaving*/appendSjcj* 等）MUST 通过 `opts.data.` 访问。

#### Scenario: 前端发 REQUEST_SAVE_PATH 不再崩
- **WHEN** 前端发 `{type:"REQUEST_SAVE_PATH", saveType:"video", ...}`，control.handleJsonControlMessage 收到
- **THEN** 调用 `opts.data.showSaveFileDialog(...)`（data 模块方法），不再误访问 `msg.showSaveFileDialog`（修复 3b-3a/3b-3b 的 `data.showSaveFileDialog` 在消息对象上调用的崩溃 bug）

### Requirement: 路由行为逐字等价
control.handleJsonControlMessage 的 switch case（ping/SET_TURNTABLE_PORT/REQUEST_SAVE_PATH/CONTROL_CMD/SAVE_B/A_FRAME_ROW/HEIXIAZI_EXCEL_HEADER/SAVE_HEIXIAZI_EXCEL_ROW/BINARIZED_PARAMS）与 handleControlCommand 的 case（START/STOP_SAVE_*/START/STOP_BINARIZED_STREAM/SEND_TO_BRIDGE2）MUST 与重构前 server.ts 逐字等价（只改变量名 data→msg + data 模块方法走 opts.data + turntable/binarized 走 opts）。

#### Scenario: SAVE_B_FRAME_ROW 走 opts.data.appendSjcjBRow
- **WHEN** control.handleJsonControlMessage 收到 `{type:"SAVE_B_FRAME_ROW", row:[...]}`
- **THEN** 调用 `opts.data.appendSjcjBRow(msg.row)`（与重构前 `data.appendSjcjBRow(data.row)` 行为等价，但 data 指 opts.data 实例而非参数）

#### Scenario: SET_TURNTABLE_PORT 走 opts.turntable.setPort
- **WHEN** 收到 `{type:"SET_TURNTABLE_PORT", port:"COM8"}`
- **THEN** 调用 `opts.turntable.setPort("COM8")`（封装关旧串口+设新+initTurntableSerial）

#### Scenario: BINARIZED_PARAMS 设状态 + 触发 video.restart
- **WHEN** 收到 `{type:"BINARIZED_PARAMS", threshold, invert}`
- **THEN** 通过 `opts.binarized.setThreshold/setInvert` 设状态；threshold 变化时调 `opts.video.restartBinarizedVideoStream()`

### Requirement: control 完整 TS 类型（无 @ts-nocheck）
`control.ts` MUST 提供完整 TypeScript 类型（ControlOptions / ControlController interface + 函数签名），MUST NOT 使用 `// @ts-nocheck`。

#### Scenario: control 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig（include control.ts）检查通过

### Requirement: server.ts 移除 control 函数 + connection handler 调 control.*
server.ts MUST 移除 handleJsonControlMessage/handleControlCommand 定义；WS connection handler 的 JSON 分支 MUST 改为 `control.handleJsonControlMessage(data, ws)`（connection handler 的 data 是 JSON.parse 的局部变量，传作 control 的 msg 参数——无冲突）。

#### Scenario: server.ts 无 control 函数定义残留
- **WHEN** grep server.ts `function handleJsonControlMessage`/`function handleControlCommand`
- **THEN** 无匹配（已迁 control.ts）
