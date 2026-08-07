# Tasks: protocol-layer-ts

> 全局约定（见 `openspec/config.yaml`）：每 change 完成后提交一次 git；测试一律 mock（不碰真实网络/串口/子进程/DOM）；不改 HTML/CSS/JS 样式；遗留代码保留且不接入。本 change 关键纪律：**4 个源文件只加 JSDoc 注解，可执行代码逐字不动**。

## 1. JSDoc 类型注解（skill: eric-backend）

- [ ] 1.1 `TcpBridge.js`：补 `@typedef {Object} CmdDef`（cmd1/cmd2/flag/len）；`@param`/`@returns` 给 `init`/`bindUDP`/`connectWS`/`handleData`/`sendPacket`/`close`；模块级 `heixiazi_flag`/`upload_count_6000h`/`yc_flag` 加 `@type`；emit 事件 payload 用 `@fires`/`@typedef` 描述。**逻辑逐字不动**。
- [ ] 1.2 `js/Udp.js`：同样补 `CmdDef` 与各方法 `@param`/`@returns`（遗留代码，注解同上，调用关系不变）。
- [ ] 1.3 `js/CommandBuilder.js`：补全 `buildPacket`（参数/返回 `Uint8Array`）与 `bufferToHex` 的 `@param`/`@returns`（已有部分，补齐）。
- [ ] 1.4 `js/BinaryTableHelper.js`：`@typedef {Object} MetaItem`（index/row/col/name/type/scale/byteWidth/offset）；`DataType` 各方法 `@param`/`@returns`；`PacketManager` 注解。
- [ ] 1.5 `npm run typecheck` 通过；`git diff` 确认 4 文件**只增加注释行**，可执行语句逐字不变。

## 2. 回归测试（skill: eric-writing-tests）

- [ ] 2.1 `tests/protocol/command-builder.test.ts`：`buildPacket` 各 cmd/payload 组合（含空 payload、Uint8Array/Array 输入）→ 字节布局断言（固定头、长度小端、地址位、命令字、payload）；`bufferToHex` 多组输入。
- [ ] 2.2 `tests/protocol/binary-table-helper.test.ts`：`parseLocData`（CSV 字符串字面量 fixture，含各类型+scale+RES）→ metaData/offset/totalBytes/buffer 分配；`setValue`/`getValue` 各 DataType 读写一致（含 scale 换算、endian）；`getIndexByName`/`getValueByName`/`setValueByName`；`formatFloat`（整数/小数/科学计数法）；`getAllValues`/`copyTo`/`loadBufferFromNet`。**不碰 DOM、不 fetch**。
- [ ] 2.3 `tests/protocol/tcp-bridge.test.ts`：构造 `new TcpBridge()` + emit 监听，喂构造 Buffer：AR 0x54/0x32/0x4A + 各 cmd → `rs485` 事件；短包/非法头 → 不 emit；`localPort==30042` → `YC`；heixiazi 分支（自包含用例，先 0x13 0x00 置 flag 再 0x13 0x01 触发）；6000H 代码上传分支。**MUST NOT 调 init/bindUDP/connectWS/sendPacket**。
- [ ] 2.4 `tests/protocol/udp-bridge.test.ts`：构造 `new UdpBridge()` + `_handleMessage` 喂构造 Buffer → 命令表路由 emit；周期报文过滤；SJCJ_trigger 分支。**MUST NOT 调 init/socket.send**。
- [ ] 2.5 `npm test` 全绿；确认全程零真实网络/串口/子进程/DOM（vitest `environment: node`，无 fetch/dgram/socket/document 调用）。

## 3. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 3.1 `npm run typecheck` / `npm test` 全通过。
- [ ] 3.2 `git diff` 4 个源文件：逐文件确认只增加 `//`/`/** */` 注解，可执行代码逐字不变（可 `git diff --stat` 看 insertions，再人工审）。
- [ ] 3.3 复核约束：`index.html`/`style.css`/JS 样式未动；遗留代码（Udp.js/ffmpeg）调用关系未变；无新增运行时依赖。
- [ ] 3.4 eric-review 自查清单（implementation degradation / 边界违规 / 过度抽象 / 样式改动 / 遗留代码接入 / 测试是否真 mock / **JSDoc 是否手滑改了逻辑**）。
- [ ] 3.5 `git commit`（本 change 一次提交）。
