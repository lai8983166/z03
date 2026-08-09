# Tasks: add-router-tests（control + DataHandler 路由测试）

> 全局约定：测试一律 mock；不改业务代码；不动 index.html/style.css。本 change 补路由层测试。

## 1. control.ts 路由测试（skill: eric-writing-tests）

- [x] 1.1 创建 `tests/control.test.ts`，构造 mock opts（data/video/turntable/binarized/wsBus 全 vi.fn）
- [x] 1.2 `handleControlCommand` 14 case 各 1 test：
  - START_SAVE_SJCJ → data.startSavingSJCJ(header, headerA)
  - STOP_SAVE_SJCJ → data.stopSavingSJCJ
  - START/STOP_SAVE_VIDEO/JG/BLACKBOX/YC（8 case）→ data.start/stopSaving*
  - STOP_SAVE_HEIXIAZI_EXCEL → data.stopSavingHeixiaziExcel
  - START/STOP_BINARIZED_STREAM（2 case）→ video.start/stop + binarized.setIsStreaming
  - SEND_TO_BRIDGE2 有 data → turntable.send(Buffer.from(data))
  - SEND_TO_BRIDGE2 无 data → turntable.send 不调
  - default（未知 action）→ console.warn
- [x] 1.3 `handleJsonControlMessage` 9 case：
  - ping → ws.send(pong)
  - SET_TURNTABLE_PORT 有效 port → turntable.setPort(upper)
  - SET_TURNTABLE_PORT 空 port → ws.send(error)
  - REQUEST_SAVE_PATH 各 saveType（video/jg/blackbox/yc/heixiazi_excel）→ data.showSaveFileDialog().then → 对应 data.startSaving*
  - REQUEST_SAVE_PATH 用户取消（filePath=null）→ wsBus.broadcast cancelled
  - CONTROL_CMD → 转发到 handleControlCommand
  - SAVE_B_FRAME_ROW → data.appendSjcjBRow
  - SAVE_A_FRAME_ROW → data.appendSjcjARow
  - HEIXIAZI_EXCEL_HEADER → data.setHeixiaziHeader
  - SAVE_HEIXIAZI_EXCEL_ROW → data.appendHeixiaziRow
  - BINARIZED_PARAMS threshold 变化 → binarized.setThreshold + video.restartBinarizedVideoStream
  - BINARIZED_PARAMS threshold 不变 → 不 restart
  - default → console.warn

## 2. DataHandler.ts 路由测试（skill: eric-writing-tests）

- [x] 2.1 创建 `tests/data-handler.test.ts`，用 vi.mock 替换 Command/ImageUpload/CodeUpload/DataRouter/Telemeter 的 handler 导出
- [x] 2.2 主要 case 各 1 test（约 20-25 个）：
  - case 0 → handle_FJYJZ_2000H
  - case 1 → handle_Shut_0004H
  - case 2 → handle_SelfTest_0002H
  - case 5 → handle_BBH_0030H
  - case 9 → handle_SJCJ_Recv_1000H
  - case 10 → handle_GetSelfTestResult_0010H
  - case 15/16/17/18 → JGCSZD/JGCSZDXC/IRDetectParam 各 handler
  - case 19（data[0]=0x15）→ handle_ImageUpload_0B00H
  - case 19（data[0]=0x40）→ handle_ImageUpload_Per_Frame_0B00H
  - case 20 → handle_SJCJ_Recv_010203H
  - case 21/23 → handle_SJCJ_Recv_F000H
  - case 22 → handle_CSZD_Recv_4000H
  - case 24（data[0]=0x15/0x16/0x40/0x55/0x65）→ 各 CodeUpload handler
  - case 25（data[0]=0x15/0x40/0x55）→ 各 codeDownload handler
  - case 27 → handle_FJYJZJG_0020H
  - case 30/31/32/33/34 → SelfTest/BBH/Shut/Wake
  - case 40（data[0]=0xFF/0x00）→ SJL_SJCJ
  - case 41 → handle_SJLTB_B
  - case 44 → handle_6000H_response
  - default（未知 flag）→ console.warn
- [x] 2.3 跑 `npm test` 全绿（含新测试）

## 3. 验证 + 提交

- [x] 3.1 `npm run typecheck` 0 错
- [x] 3.2 `npm test` 通过（预期 ~110-120 个测试，61 基线 + ~50-60 新增）
- [x] 3.3 grep 复核测试代码无 `as any`（用 `as unknown as`）；无真实 IO
- [x] 3.4 eric-review 自查（重点：mock 完整性、case 覆盖、参数验证）
- [x] 3.5 `git commit` + `git push`
