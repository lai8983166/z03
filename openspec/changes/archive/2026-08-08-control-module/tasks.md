# Tasks: 3b-4 control 模块 + 修参数名 bug

> 全局约定：每 change 提交一次 git；不改 HTML/CSS/JS 样式。本 change 关键纪律：**参数 data → msg（修 3b-3a/3b-3b 参数名冲突 bug），data 模块方法走 opts.data**。逐 case 审查。

## 1. 创建 control.ts（skill: eric-backend）

- [ ] 1.1 新建 `control.ts`：导出 `createControl(opts)` 工厂 + `ControlOptions`/`ControlController` interface。opts: wsBus/data(DataController)/video(VideoController)/turntable({send(buf),setPort(port)})/binarized({getInvert,setInvert,getThreshold,setThreshold,getIsStreaming,setIsStreaming})。**完整 TS 类型，无 @ts-nocheck**。
- [ ] 1.2 handleJsonControlMessage(msg, ws) 逐字搬迁自 server.ts line 603-697（参数 data→msg；switch case 不变）：
  - ping / SET_TURNTABLE_PORT（opts.turntable.setPort）/ REQUEST_SAVE_PATH（opts.data.showSaveFileDialog + opts.data.startSaving*）/ CONTROL_CMD（handleControlCommand）/ SAVE_B/A_FRAME_ROW（opts.data.appendSjcj*）/ HEIXIAZI_EXCEL_HEADER（opts.data.setHeixiaziHeader）/ SAVE_HEIXIAZI_EXCEL_ROW（opts.data.appendHeixiaziRow）/ BINARIZED_PARAMS（opts.binarized.set* + opts.video.restartBinarized）
  - **消息字段用 msg.**（type/port/saveType/defaultName/filter/row/header/threshold/invert/action/filePath/data/headerA）
  - **data 模块方法用 opts.data.**
- [ ] 1.3 handleControlCommand(msg) 逐字搬迁 line 703-756（参数 data→msg）：
  - START/STOP_SAVE_SJCJ/VIDEO/JG/BLACKBOX/YC/HEIXIAZI_EXCEL（opts.data.*）/ START/STOP_BINARIZED_STREAM（opts.video.* + opts.binarized.setIsStreaming）/ SEND_TO_BRIDGE2（opts.turntable.send）
- [ ] 1.4 `tsconfig.node.json` include 加 `control.ts`；`npx tsc -p tsconfig.node.json --noEmit` 通过

## 2. server.ts 改用 control（skill: eric-backend）

- [ ] 2.1 server.ts 顶部 `import { createControl } from "./control";`
- [ ] 2.2 创建 control（在 data/video 后）：
  ```ts
  const control = createControl({
    wsBus, data, video,
    turntable: {
      send: (buf) => sendToTurntableSerial(buf),
      setPort: (port) => {
        if (turntableSerial && turntableSerial.isOpen) { turntableSerial.close(() => {}); turntableSerial = null; }
        TURNTABLE_SERIAL_PORT = port;
        initTurntableSerial();
      },
    },
    binarized: {
      getInvert: () => binarizedInvert, setInvert: (v) => { binarizedInvert = v; },
      getThreshold: () => binarizedThreshold, setThreshold: (v) => { binarizedThreshold = v; },
      getIsStreaming: () => isStreamingBinarizedVideo, setIsStreaming: (v) => { isStreamingBinarizedVideo = v; },
    },
  });
  ```
- [ ] 2.3 移除 server.ts 的 handleJsonControlMessage/handleControlCommand 函数定义（~150 行）
- [ ] 2.4 WS connection handler 的 JSON 分支：`handleJsonControlMessage(data, ws)` → `control.handleJsonControlMessage(data, ws)`（connection handler 的 data 是 JSON.parse 局部变量，传作 control 的 msg 参数——无冲突）
- [ ] 2.5 grep 复核：server.ts 无 `function handleJsonControlMessage`/`function handleControlCommand` 定义；无裸 `handleJsonControlMessage(`/`handleControlCommand(` 调用（都走 control.*）

## 3. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 3.1 `npm run typecheck` 通过（control.ts 无 @ts-nocheck 被检查）
- [ ] 3.2 `npm test` 通过（61 旧，无新单测）
- [ ] 3.3 `npm run dev:server`（tsx）启动正常
- [ ] 3.4 grep 复核 server.ts 无 control 函数定义；control.ts 无 @ts-nocheck；control.ts 无 server.ts 全局引用（turntableSerial/binarizedInvert 等，都走 opts）
- [ ] 3.5 **人工触发前端消息对照**（关键——验证 bug 修复 + 路由）：
  - REQUEST_SAVE_PATH（之前崩，修复后弹对话框 + 开始保存）
  - CONTROL_CMD 的 START_SAVE_VIDEO/JG/BLACKBOX/YC/SJCJ + STOP
  - SAVE_B/A_FRAME_ROW（SJCJ 数据接收）
  - HEIXIAZI_EXCEL_HEADER + SAVE_HEIXIAZI_EXCEL_ROW
  - BINARIZED_PARAMS（设阈值 + 重启流）
  - SET_TURNTABLE_PORT（切串口）
  - SEND_TO_BRIDGE2（转台转发）
- [ ] 3.6 复核约束：index.html/style.css/JS 样式未动；turntable/binarized* 留 server.ts
- [ ] 3.7 eric-review 自查（重点：参数 msg 是否全改、opts.data 是否正确、bug 是否修复、逐 case 等价）
- [ ] 3.8 `git commit`
