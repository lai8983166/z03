/**
 * TurntableControl.js
 * 转台控制模块
 *
 * 工具函数：
 *   - readTxtFileAsLines()  弹出文件选择框，读取 txt 并返回字符串数组（每行一个元素）
 *   - saveLinesToTxtFile()  弹出文件保存框，将字符串数组写入 txt 文件
 *
 * 转台报文构造与发送（基于《两轴台远程串口通讯标准协议》A3/A4节）：
 *   - buildTurntableFrame(cmd, ...params)  构造一帧下行报文字符串
 *   - sendTurntableCmd(cmd, ...params)     构造并通过 Bridge2 发送一帧报文
 *   - tt_check()         (1)  通讯检查
 *   - tt_remote()        (2)  进入远控模式
 *   - tt_local()         (3)  返回本控模式
 *   - tt_enable()        (4)  使能
 *   - tt_disable()       (5)  断开使能
 *   - tt_homing()        (6)  寻零
 *   - tt_setMode(a, b)   (7)  运行模式 (0=位置, 1=速率, 2=角振动)
 *   - tt_setPos(inner, outer)  (8)  位置设置 (°)
 *   - tt_setVel(inner, outer)  (9)  速率设置 (°/s)
 *   - tt_setAcc(inner, outer)  (10) 加速度设置 (°/s²)
 *   - tt_setAmp(inner, outer)  (11) 角振动幅值设置 (°)
 *   - tt_setFre(inner, outer)  (12) 角振动频率设置 (Hz)
 *   - tt_run()           (13) 启动
 *   - tt_stop()          (14) 停止
 *   - tt_queryStatus()   (15) 状态查询
 *   - tt_exit()          (16) 退出
 *   - tt_setChamberTemp(temp)  (17) 设定温箱温度 (℃)
 *   - tt_applyChamberTemp()    (18) 置入设定温度
 *   - tt_chamberStart()        (19) 温箱启动
 *   - tt_chamberStop()         (20) 温箱关闭
 *   - tt_readChamberTemp()     (21) 读取当前温度
 */

// ==================== 文件读写工具 ====================

/**
 * 弹出系统文件选择框，读取用户选择的 txt 文件，
 * 返回一个字符串数组，每个元素对应文件中的一行（自动去除空行）。
 *
 * @param {object}   [options]
 * @param {boolean}  [options.skipEmpty=true]  是否跳过空行
 * @param {boolean}  [options.trim=true]       是否对每行做 trim()
 * @returns {Promise<string[]>}  解析后的行数组；用户取消时返回 null
 *
 * 使用示例：
 *   const lines = await readTxtFileAsLines();
 *   if (lines) console.log(lines); // ["第一行", "第二行", ...]
 */
export function readTxtFileAsLines({ skipEmpty = true, trim = true } = {}) {
  return new Promise((resolve) => {
    // 创建隐藏的 <input type="file"> 触发系统文件选择框
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;

        // 统一换行符（兼容 \r\n / \r / \n）
        let lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

        if (trim)      lines = lines.map((l) => l.trim());
        if (skipEmpty) lines = lines.filter((l) => l.length > 0);

        resolve(lines);
      };
      reader.onerror = () => {
        console.error("[TurntableControl] 文件读取失败");
        resolve(null);
      };
      reader.readAsText(file, "utf-8");
    });

    // 用户直接关闭对话框时触发 cancel（现代浏览器支持）
    input.addEventListener("cancel", () => resolve(null));

    document.body.appendChild(input);
    input.click();
    // 短暂延迟后移除，确保事件能触发
    setTimeout(() => document.body.removeChild(input), 10000);
  });
}

/**
 * 弹出系统文件保存框，将字符串数组写入 txt 文件，每个元素占一行。
 *
 * 优先使用现代 File System Access API（showSaveFilePicker），
 * 若浏览器不支持则降级为创建下载链接。
 *
 * @param {string[]} lines           要保存的字符串数组
 * @param {string}   [filename]      默认文件名，默认 "output.txt"
 * @param {string}   [lineEnding]    换行符，默认 "\r\n"（Windows 记事本兼容）
 * @returns {Promise<boolean>}       保存成功返回 true，取消或失败返回 false
 *
 * 使用示例：
 *   const ok = await saveLinesToTxtFile(["第一行", "第二行"], "结果.txt");
 *   if (ok) console.log("保存成功");
 */
export async function saveLinesToTxtFile(lines, filename = "output.txt", lineEnding = "\r\n") {
  if (!Array.isArray(lines)) {
    console.error("[TurntableControl] saveLinesToTxtFile: 参数必须是数组");
    return false;
  }

  const content = lines.join(lineEnding);
  const blob = new Blob(["\uFEFF" + content], { type: "text/plain;charset=utf-8" }); // BOM 防止中文乱码

  // ---- 方案A：File System Access API（Chrome/Edge 支持，有原生保存框）----
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "文本文件", accept: { "text/plain": [".txt"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      console.log("[TurntableControl] 文件已保存（File System Access API）");
      return true;
    } catch (err) {
      if (err.name === "AbortError") {
        // 用户取消
        return false;
      }
      console.warn("[TurntableControl] showSaveFilePicker 失败，降级到下载链接:", err);
      // 降级到方案B
    }
  }

  // ---- 方案B：创建 <a download> 触发浏览器下载（兼容所有浏览器）----
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
  console.log("[TurntableControl] 文件已触发下载（<a download> 降级）");
  return true;
}

// ==================== 转台报文构造与发送 ====================

import wsClient from "./Client.js";
import {
  setBFrameRawCallback,
  getSJCJF000HRunning,
  startSJCJF000H,
  stopSJCJF000H,
} from "./Command.js";

/**
 * 计算协议校验和。
 * 规则：从 `$` 到 `*`（不含两端）之间所有字符的字节异或和，取低8位，
 * 以两位大写十六进制表示。
 *
 * @param {string} body  `$` 和 `*` 之间的字符串，例如 "MNPOS,0.0000,123.4567"
 * @returns {string}     两位大写十六进制，例如 "9D"
 */
function calcChecksum(body) {
  let xor = 0;
  for (let i = 0; i < body.length; i++) {
    xor ^= body.charCodeAt(i);
  }
  return (xor & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

/**
 * 将数值格式化为协议要求的定点小数字符串。
 * 整数部分最少1位，小数部分固定4位，负号保留。
 * 例：123.4567 → "123.4567"，-1.2 → "-1.2000"，0 → "0.0000"
 *
 * @param {number} val
 * @param {number} [decimals=4]
 * @returns {string}
 */
function fmtNum(val, decimals = 4) {
  return Number(val).toFixed(decimals);
}

/**
 * 构造一帧完整的下行报文字符串（含起止符和校验和）。
 *
 * 协议格式：`$MN{cmd},{param1},{param2},...*{xx}\r\n`
 *
 * @param {string}    cmd     命令域，如 "POS"、"VEL"、"CHK"
 * @param {...string} params  命令参数列表（已格式化为字符串）
 * @returns {string}  完整报文，例如 "$MNPOS,0.0000,123.4567*9D\r\n"
 */
export function buildTurntableFrame(cmd, ...params) {
  const body = "MN" + cmd + (params.length > 0 ? "," + params.join(",") : "");
  const checksum = calcChecksum(body);
  return "$" + body + "*" + checksum + "\r\n";
}

/**
 * 构造报文并通过 SEND_TO_BRIDGE2 发送给转台。
 * 报文以 UTF-8 字节数组的形式透传。
 *
 * @param {string}    cmd
 * @param {...string} params
 * @returns {boolean}  wsClient.sendText 的返回值
 */
export function sendTurntableCmd(cmd, ...params) {
  const frame = buildTurntableFrame(cmd, ...params);
  console.log("[Turntable] 发送:", frame.replace(/\r\n$/, "\\r\\n"));
  // 将字符串转为字节数组（ASCII 范围内与 UTF-8 相同）
  const bytes = Array.from(frame).map((c) => c.charCodeAt(0));
  return wsClient.sendText(
    JSON.stringify({ type: "CONTROL_CMD", action: "SEND_TO_BRIDGE2", data: bytes }),
  );
}

// ----------------------------------------------------------------
// 以下各函数与协议 A4 节编号一一对应
// ----------------------------------------------------------------

/** (1) 通讯检查 */
export function tt_check() {
  return sendTurntableCmd("CHK", "1");
}

/** (2) 进入远控模式 */
export function tt_remote() {
  return sendTurntableCmd("REM", "1");
}

/** (3) 返回本控模式 */
export function tt_local() {
  return sendTurntableCmd("LOC", "1");
}

/** (4) 使能 */
export function tt_enable() {
  return sendTurntableCmd("ENB", "1");
}

/** (5) 断开使能 */
export function tt_disable() {
  return sendTurntableCmd("DIS", "1");
}

/** (6) 寻零 */
export function tt_homing() {
  return sendTurntableCmd("HMZ", "1");
}

/**
 * (7) 运行模式设置
 * @param {0|1|2} inner  内环模式：0=位置, 1=速率, 2=角振动
 * @param {0|1|2} outer  外环模式：0=位置, 1=速率, 2=角振动
 */
export function tt_setMode(inner, outer) {
  return sendTurntableCmd("MOD", String(inner), String(outer));
}

/**
 * (8) 位置设置
 * @param {number} inner  内环目标位置 (°)，保留4位小数
 * @param {number} outer  外环目标位置 (°)，保留4位小数
 */
export function tt_setPos(inner, outer) {
  return sendTurntableCmd("POS", fmtNum(inner), fmtNum(outer));
}

/**
 * (9) 速率设置
 * @param {number} inner  内环目标速率 (°/s)，可为负值
 * @param {number} outer  外环目标速率 (°/s)，可为负值
 */
export function tt_setVel(inner, outer) {
  return sendTurntableCmd("VEL", fmtNum(inner), fmtNum(outer));
}

/**
 * (10) 加速度设置（只能为正数）
 * @param {number} inner  内环加速度 (°/s²)
 * @param {number} outer  外环加速度 (°/s²)
 */
export function tt_setAcc(inner, outer) {
  return sendTurntableCmd("ACC", fmtNum(Math.abs(inner)), fmtNum(Math.abs(outer)));
}

/**
 * (11) 角振动幅值设置（只能为正数）
 * @param {number} inner  内环幅值 (°)
 * @param {number} outer  外环幅值 (°)
 */
export function tt_setAmp(inner, outer) {
  return sendTurntableCmd("AMP", fmtNum(Math.abs(inner)), fmtNum(Math.abs(outer)));
}

/**
 * (12) 角振动频率设置（只能为正数）
 * @param {number} inner  内环频率 (Hz)
 * @param {number} outer  外环频率 (Hz)
 */
export function tt_setFre(inner, outer) {
  return sendTurntableCmd("FRE", fmtNum(Math.abs(inner)), fmtNum(Math.abs(outer)));
}

/** (13) 启动 */
export function tt_run() {
  return sendTurntableCmd("RUN", "1");
}

/** (14) 停止 */
export function tt_stop() {
  return sendTurntableCmd("STP", "1");
}

/** (15) 状态查询 */
export function tt_queryStatus() {
  return sendTurntableCmd("STS", "1");
}

/** (16) 退出 */
export function tt_exit() {
  return sendTurntableCmd("EXT", "1");
}

/**
 * (17) 设定温箱温度
 * @param {number} temp  目标温度 (℃)，保留1位小数，如 50.0
 */
export function tt_setChamberTemp(temp) {
  return sendTurntableCmd("CEM", fmtNum(temp, 1));
}

/** (18) 置入设定的温度 */
export function tt_applyChamberTemp() {
  return sendTurntableCmd("CRN", "1");
}

/** (19) 温箱启动 */
export function tt_chamberStart() {
  return sendTurntableCmd("CEN", "1");
}

/** (20) 温箱关闭 */
export function tt_chamberStop() {
  return sendTurntableCmd("CST", "1");
}

/** (21) 读取当前温度值 */
export function tt_readChamberTemp() {
  return sendTurntableCmd("CRT", "1");
}

// ==================== 应答解析 ====================

/**
 * 解析状态查询应答帧，更新 UI 状态表格。
 * 应答格式：$ASSTS,P1,V1,X,P2,V2,Y,OK*xx\r\n
 *
 * @param {string} frame  完整的应答帧字符串
 */
export function parseTurntableStatusFrame(frame) {
  // 取 $ 和 * 之间的内容，去掉 "ASSTS," 前缀
  const match = frame.match(/\$ASSTS,([^*]+)\*/);
  if (!match) return;
  const parts = match[1].split(",");
  // parts: [P1, V1, X, P2, V2, Y, OK]
  if (parts.length < 6) return;

  const [p1, v1, x, p2, v2, y] = parts;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? "--"; };

  set("tt_td_inner_pos",   p1);
  set("tt_td_inner_vel",   v1);
  set("tt_td_inner_state", x);
  set("tt_td_outer_pos",   p2);
  set("tt_td_outer_vel",   v2);
  set("tt_td_outer_state", y);

  // 解析状态字位（11位）
  const parseStateBits = (hexStr, prefix) => {
    const val = parseInt(hexStr, 16) || 0;
    const names = ["b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","b10"];
    names.forEach((name, i) => {
      const bit = (val >> i) & 1;
      const el = document.getElementById(`tt_${prefix}_${name}`);
      if (el) {
        el.textContent = bit ? "✓" : "✗";
        el.style.color  = bit ? "green" : "#aaa";
      }
    });
  };
  parseStateBits(x, "inner");
  parseStateBits(y, "outer");
}

/**
 * 解析读温度应答帧，更新温度显示。
 * 应答格式：$ASCRT,ab.c,OK*xx\r\n
 *
 * @param {string} frame
 */
export function parseTurntableTempFrame(frame) {
  const match = frame.match(/\$ASCRT,([^,*]+)/);
  if (!match) return;
  const el = document.getElementById("tt_span_chamber_temp_display");
  if (el) el.textContent = match[1] + " ℃";
}

/**
 * 将一行原始应答追加到日志区域。
 *
 * @param {string} line
 */
export function appendTurntableLog(line) {
  const el = document.getElementById("tt_log");
  if (!el) return;
  const p = document.createElement("div");
  p.textContent = line.replace(/\r\n$/, "");
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}

// ==================== UI 初始化 ====================

/**
 * 绑定转台控制 Tab（tab-18）内所有按钮的点击事件。
 * 在页面加载后调用一次。
 */
export function initTurntableUI() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };

  // 基本控制
  bind("tt_btn_check",   () => tt_check());
  bind("tt_btn_remote",  () => tt_remote());
  bind("tt_btn_local",   () => tt_local());
  bind("tt_btn_enable",  () => tt_enable());
  bind("tt_btn_disable", () => tt_disable());
  bind("tt_btn_homing",  () => tt_homing());
  bind("tt_btn_run",     () => tt_run());
  bind("tt_btn_stop",    () => tt_stop());
  bind("tt_btn_status",  () => tt_queryStatus());
  bind("tt_btn_exit",    () => tt_exit());

  // 运行模式
  bind("tt_btn_set_mode", () => {
    const inner = parseInt(document.getElementById("tt_select_inner_mode")?.value ?? "0");
    const outer = parseInt(document.getElementById("tt_select_outer_mode")?.value ?? "0");
    tt_setMode(inner, outer);
  });

  // 位置设置
  bind("tt_btn_set_pos", () => {
    const inner = parseFloat(document.getElementById("tt_input_inner_pos")?.value ?? "0");
    const outer = parseFloat(document.getElementById("tt_input_outer_pos")?.value ?? "0");
    tt_setPos(inner, outer);
  });

  // 速率设置
  bind("tt_btn_set_vel", () => {
    const inner = parseFloat(document.getElementById("tt_input_inner_vel")?.value ?? "0");
    const outer = parseFloat(document.getElementById("tt_input_outer_vel")?.value ?? "0");
    tt_setVel(inner, outer);
  });

  // 加速度设置
  bind("tt_btn_set_acc", () => {
    const inner = parseFloat(document.getElementById("tt_input_inner_acc")?.value ?? "10");
    const outer = parseFloat(document.getElementById("tt_input_outer_acc")?.value ?? "10");
    tt_setAcc(inner, outer);
  });

  // 幅值设置
  bind("tt_btn_set_amp", () => {
    const inner = parseFloat(document.getElementById("tt_input_inner_amp")?.value ?? "1");
    const outer = parseFloat(document.getElementById("tt_input_outer_amp")?.value ?? "1");
    tt_setAmp(inner, outer);
  });

  // 频率设置
  bind("tt_btn_set_fre", () => {
    const inner = parseFloat(document.getElementById("tt_input_inner_fre")?.value ?? "1");
    const outer = parseFloat(document.getElementById("tt_input_outer_fre")?.value ?? "1");
    tt_setFre(inner, outer);
  });

  // 温箱控制
  bind("tt_btn_set_chamber_temp",   () => {
    const temp = parseFloat(document.getElementById("tt_input_chamber_temp")?.value ?? "50");
    tt_setChamberTemp(temp);
  });
  bind("tt_btn_apply_chamber_temp", () => tt_applyChamberTemp());
  bind("tt_btn_chamber_start",      () => tt_chamberStart());
  bind("tt_btn_chamber_stop",       () => tt_chamberStop());
  bind("tt_btn_read_chamber_temp",  () => tt_readChamberTemp());

  // ---- 订阅服务端转发的转台上行帧 ----
  // server.js 广播 { type:"turntable_reply", text:"$AS..." }
  // wsClient 的 on() 按 JSON type 字段分发
  wsClient.on("turntable_reply", (msg) => {
    const text = msg.text ?? "";
    if (!text) return;

    // 追加原始日志
    appendTurntableLog(text);

    // 按命令类型分发解析
    if (text.includes("$ASSTS,")) {
      parseTurntableStatusFrame(text);
      // 缓存实际位置供校准扫描使用（P1=内环/方位, P2=外环/俯仰）
      const mPos = text.match(/\$ASSTS,([^,*]+),([^,*]+),([^,*]+),([^,*]+),([^,*]+),([^,*]+)/);
      if (mPos) {
        _lastActualPos = { az: parseFloat(mPos[1]), el: parseFloat(mPos[4]) };
      }
      // 到位检测：V1/V2（内外环实际速率）均为 0 表示转台已静止
      if (_arriveCallback) {
        const m = text.match(/\$ASSTS,([^,*]+),([^,*]+),([^,*]+),([^,*]+),([^,*]+),([^,*]+)/);
        if (m) {
          const innerVel = parseFloat(m[2]);
          const outerVel = parseFloat(m[5]);
          const innerMoving = innerVel !== 0;
          const outerMoving = outerVel !== 0;
          _arriveCallback({ innerMoving, outerMoving });
        }
      }
    } else if (text.includes("$ASCRT,")) {
      parseTurntableTempFrame(text);
    }
    // 其他应答（CHK/REM/LOC/ENB/DIS/HMZ/RUN/STP/EXT/MOD/POS/VEL/ACC/AMP/FRE/CEM/CRN/CEN/CST）
    // 只记录日志，不做额外解析
  });

  // ---- 串口配置：连接按钮 ----
  bind("tt_btn_connect_serial", () => {
    const portInput = document.getElementById("tt_input_serial_port");
    const statusEl  = document.getElementById("tt_serial_status");
    const port = (portInput?.value ?? "").trim().toUpperCase();
    if (!port) {
      if (statusEl) { statusEl.textContent = "❌ 请输入串口号"; statusEl.style.color = "#f66"; }
      return;
    }
    if (statusEl) { statusEl.textContent = "⏳ 连接中..."; statusEl.style.color = "#fa0"; }
    wsClient.sendText(JSON.stringify({ type: "SET_TURNTABLE_PORT", port }));
  });

  // ---- 订阅服务端串口状态消息 ----
  wsClient.on("turntable_serial_ready", (msg) => {
    const statusEl = document.getElementById("tt_serial_status");
    if (statusEl) {
      statusEl.textContent = `✅ 已连接 ${msg.port ?? ""}`;
      statusEl.style.color = "#4c4";
    }
    // 同步输入框显示
    const portInput = document.getElementById("tt_input_serial_port");
    if (portInput && msg.port) portInput.value = msg.port;
  });

  wsClient.on("turntable_serial_error", (msg) => {
    const statusEl = document.getElementById("tt_serial_status");
    if (statusEl) {
      statusEl.textContent = `❌ ${msg.message ?? "串口错误"}`;
      statusEl.style.color = "#f66";
    }
  });

  wsClient.on("turntable_serial_closed", () => {
    const statusEl = document.getElementById("tt_serial_status");
    if (statusEl) { statusEl.textContent = "⚠️ 串口已关闭"; statusEl.style.color = "#fa0"; }
  });

  console.log("[TurntableControl] UI 初始化完成");

  // ---- 校准扫描按钮 ----
  const calBtnStart = document.getElementById("cal_btn_start");
  const calBtnStop  = document.getElementById("cal_btn_stop");
  if (calBtnStart) {
    calBtnStart.addEventListener("click", () => {
      runCalibrationScan();
    });
  }
  if (calBtnStop) {
    calBtnStop.addEventListener("click", () => {
      _calScanAbort = true;
      const calStatus = document.getElementById("cal_status");
      if (calStatus) calStatus.textContent = "正在中止...";
    });
  }

  // ---- Excel 位置序列扫描按钮 ----
  const excelBtnOpen  = document.getElementById("excel_scan_btn_open");
  const excelBtnStart = document.getElementById("excel_scan_btn_start");
  const excelBtnStop  = document.getElementById("excel_scan_btn_stop");

  if (excelBtnOpen) {
    excelBtnOpen.addEventListener("click", async () => {
      const positions = await readExcelPositions();
      if (!positions) {
        const fnEl = document.getElementById("excel_scan_filename");
        if (fnEl) fnEl.textContent = "读取失败或已取消";
        if (excelBtnStart) excelBtnStart.disabled = true;
        return;
      }
      // 缓存到全局，供 runExcelScan 读取
      window._excelScanPositions = positions;
      const fnEl = document.getElementById("excel_scan_filename");
      if (fnEl) fnEl.textContent += `  （共 ${positions.length} 行）`;
      if (excelBtnStart) excelBtnStart.disabled = false;
      const logEl = document.getElementById("excel_scan_log");
      if (logEl) {
        logEl.textContent = `已加载 ${positions.length} 个位置点。\n前3行预览：\n`
          + positions.slice(0, 3).map((p, i) =>
            `  ${i+1}. 方位=${p[0]}°  俯仰=${p[1]}°  A=${p[2]}  B=${p[3]}`
          ).join("\n");
      }
    });
  }

  if (excelBtnStart) {
    excelBtnStart.addEventListener("click", () => {
      runExcelScan();
    });
  }

  if (excelBtnStop) {
    excelBtnStop.addEventListener("click", () => {
      _excelScanAbort = true;
      const statusEl = document.getElementById("excel_scan_status");
      if (statusEl) { statusEl.textContent = "正在中止..."; statusEl.style.color = "orange"; }
    });
  }
}

// ==================== 校准扫描 ====================

/** 中止标志，由"中止扫描"按钮置位 */
let _calScanAbort = false;

/**
 * 到位检测回调：每次收到 $ASSTS 帧时调用，传入 { innerMoving, outerMoving }。
 * 由 waitForTurntableArrive() 注册，到位后自行清除。
 */
let _arriveCallback = null;

/** 最近一次 $ASSTS 解析出的实际位置，{ az: number, el: number } */
let _lastActualPos = null;

/**
 * 发送一次状态查询，等待 $ASSTS 回复，返回实际位置 { az, el }。
 * 最多等待 timeoutMs，超时返回 null。
 *
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<{az:number, el:number}|null>}
 */
function queryActualPos(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    let poll;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);   // 无论超时还是正常返回，都清除轮询
      clearTimeout(timer);
      resolve(result);
    };
    const prevPos = _lastActualPos;
    const timer = setTimeout(() => done(null), timeoutMs);
    // 轮询 _lastActualPos 是否更新（每 50ms 检查一次）
    poll = setInterval(() => {
      if (_lastActualPos !== prevPos && _lastActualPos !== null) {
        done(_lastActualPos);
      }
    }, 50);
    tt_queryStatus();
  });
}

/**
 * 等待转台到位。
 *
 * 策略：每隔 pollMs 向转台发一次状态查询指令，收到 $ASSTS 回复后检查
 * 内环速率 V1 和外环速率 V2 是否都为 0（即转台已静止）。
 * 若在 timeoutMs 内两轴都静止则 resolve(true)；超时则 resolve(false)（记警告但继续）。
 *
 * @param {number} timeoutMs  最长等待时间（ms）
 * @param {number} [pollMs=200]  状态查询间隔（ms）
 * @returns {Promise<boolean>}  true=正常到位，false=超时强制继续
 */
function waitForTurntableArrive(timeoutMs, pollMs = 200) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      _arriveCallback = null;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      resolve(result);
    };

    // 注册到位回调
    _arriveCallback = ({ innerMoving, outerMoving }) => {
      if (!innerMoving && !outerMoving) done(true);
    };

    // 定时轮询状态
    const pollTimer = setInterval(() => {
      if (!settled) tt_queryStatus();
    }, pollMs);

    // 超时保护
    const timeoutTimer = setTimeout(() => done(false), timeoutMs);

    // 立即先查一次，避免已经静止时多等一个 pollMs
    tt_queryStatus();
  });
}

/**
 * 校准扫描主函数：
 * 1. 按间隔生成扫描位置列表
 * 2. 依次发送转台位置指令，等待到位（轮询 $ASSTS bit4）
 * 3. 启动 F000H 采集，收集 N 帧 B 帧，提取 KFJ_FWJ / KFJ_FYJ 的平均值
 * 4. 全部完成后保存两张表到 txt
 */
export async function runCalibrationScan() {
  // ---------- 读取 UI 参数 ----------
  const startAz  = parseFloat(document.getElementById("cal_start_az")?.value ?? "0");
  const startEl  = parseFloat(document.getElementById("cal_start_el")?.value ?? "0");
  const endAz    = parseFloat(document.getElementById("cal_end_az")?.value   ?? "10");
  const endEl    = parseFloat(document.getElementById("cal_end_el")?.value   ?? "0");
  const stepAz   = Math.abs(parseFloat(document.getElementById("cal_step_az")?.value ?? "1")) || 1;
  const stepEl   = Math.abs(parseFloat(document.getElementById("cal_step_el")?.value ?? "1")) || 1;
  const frames   = Math.max(0, parseInt(document.getElementById("cal_frames")?.value ?? "100"));
  const waitMs   = Math.max(100, parseInt(document.getElementById("cal_wait_ms")?.value ?? "2000"));

  const calStatus  = document.getElementById("cal_status");
  const calLog     = document.getElementById("cal_log");
  const calBtnStart = document.getElementById("cal_btn_start");
  const calBtnStop  = document.getElementById("cal_btn_stop");

  const setStatus = (msg, color = "#e0e0e0") => {
    if (calStatus) { calStatus.textContent = msg; calStatus.style.color = color; }
  };
  const log = (msg) => {
    if (calLog) {
      calLog.textContent += msg + "\n";
      calLog.scrollTop = calLog.scrollHeight;
    }
  };

  if (isNaN(startAz) || isNaN(startEl) || isNaN(endAz) || isNaN(endEl)) {
    setStatus("参数错误：请检查输入", "red");
    return;
  }

  // ---------- 计算总步数（步长可正可负，步数取绝对值） ----------
  // 外层循环俯仰（elSteps 行），内层循环方位（azSteps 列），2D 网格扫描
  const azSteps = endAz === startAz ? 0 : Math.round(Math.abs(endAz - startAz) / Math.abs(stepAz));
  const elSteps = endEl === startEl ? 0 : Math.round(Math.abs(endEl - startEl) / Math.abs(stepEl));
  const totalPoints = (azSteps + 1) * (elSteps + 1);  // 含初始点

  // ---------- 准备状态 ----------
  _calScanAbort = false;
  if (calBtnStart) calBtnStart.disabled = true;
  if (calBtnStop)  calBtnStop.disabled  = false;
  if (calLog) calLog.textContent = "";
  log(`[校准扫描] 共 ${totalPoints} 个位置（含初始点），每点采集 ${frames} 帧，到位超时 ${waitMs} ms`);
  log(`[校准扫描] 方位 ${startAz}° → ${endAz}°  间隔 ${stepAz}°  步数 ${azSteps}`);
  log(`[校准扫描] 俯仰 ${startEl}° → ${endEl}°  间隔 ${stepEl}°  步数 ${elSteps}`);
  log(`[校准扫描] 注意：txt 中位置均取绝对值（间隔方向无关）`);

  const recordsFwj = [];   // "txt_az,txt_el,kfj_fwj"
  const recordsFyj = [];   // "txt_az,txt_el,kfj_fyj"

  // ---------- 确保 F000H 采集已启动（frames=0 时跳过） ----------
  const wasRunning = getSJCJF000HRunning();
  if (frames === 0) {
    log("[校准扫描] 采集帧数为 0，跳过 F000H 数据采集");
  } else if (!wasRunning) {
    startSJCJF000H();
    log("[校准扫描] F000H 数据采集已自动启动");
  }

  // 实际发送给转台的当前位置（从 $ASSTS 读取后累加间隔）
  let actualAz = null;
  let actualEl = null;
  // 每行行首的实际方位（初始点查询后记录，俯仰换行时用于方位回退）
  let rowStartActualAz = null;

  try {
    for (let ei = 0; ei <= elSteps; ei++) {
      for (let ai = 0; ai <= azSteps; ai++) {
        if (_calScanAbort) {
          log("[校准扫描] 用户中止");
          setStatus("已中止", "orange");
          break;
        }

        const pointIdx = ei * (azSteps + 1) + ai + 1;
        const isFirstPoint = (ei === 0 && ai === 0);

        // txt 中的逻辑位置（绝对值，不含方向）
        const txtAz = +(startAz + ai * Math.abs(stepAz)).toFixed(6);
        const txtEl = +(startEl + ei * Math.abs(stepEl)).toFixed(6);

        if (isFirstPoint) {
          // ---- 初始点：不控制转台，先查询当前实际位置作为累加基准 ----
          log(`\n[第 1/${totalPoints} 点（初始点）] 查询当前实际位置…`);
          setStatus(`查询初始位置…`, "#7ec8f0");

          const pos = await queryActualPos(waitMs);
          if (_calScanAbort) break;

          if (pos) {
            // 若读回的位置大于 140°，说明转台以正值表示负角（如 270° 实为 -90°），折叠回负值域
            actualAz = pos.az > 140 ? pos.az - 360 : pos.az;
            actualEl = pos.el > 140 ? pos.el - 360 : pos.el;
            log(`  → 当前实际位置：方位=${actualAz}°  俯仰=${actualEl}°`);
          } else {
            log(`  ⚠ 查询实际位置超时，以输入的起始位置 (${startAz}°, ${startEl}°) 为基准`);
            actualAz = startAz;
            actualEl = startEl;
          }
          // 记录行首方位，供俯仰换行时方位回退使用
          rowStartActualAz = actualAz;
          log(`  → txt 记录位置：方位=${txtAz}°  俯仰=${txtEl}°`);
          setStatus(`扫描中 ${pointIdx}/${totalPoints}  采集初始点`, "#7ec8f0");

        } else {
          // ---- 后续点：基于实际位置累加步长 ----
          if (ai === 0) {
            // 俯仰换行：方位回到行首（初始点查到的实际方位），俯仰步进一格
            actualAz = rowStartActualAz;
            actualEl = +(actualEl + stepEl).toFixed(6);
            if (actualEl > 140) actualEl = +(actualEl - 360).toFixed(6);
          } else {
            // 方位步进一格（步长含方向），大于 140° 则折叠
            actualAz = +(actualAz + stepAz).toFixed(6);
            if (actualAz > 140) actualAz = +(actualAz - 360).toFixed(6);
          }

          setStatus(`扫描中 ${pointIdx}/${totalPoints}  az=${actualAz}° el=${actualEl}°`, "#7ec8f0");
          log(`\n[第 ${pointIdx}/${totalPoints} 点] 目标位置：方位=${actualAz}°  俯仰=${actualEl}°`);
          log(`  → txt 记录位置：方位=${txtAz}°  俯仰=${txtEl}°`);

          // 发送位置指令并启动
          tt_setPos(actualAz, actualEl);
          tt_run();
          log(`  → 已发送位置指令并启动，等待到位（超时 ${waitMs} ms）…`);

          // 等待到位
          const arrived = await waitForTurntableArrive(waitMs);
          if (_calScanAbort) {
            log("[校准扫描] 用户中止（等待期间）");
            setStatus("已中止", "orange");
            break;
          }
          if (!arrived) {
            log(`  ⚠ 等待到位超时（${waitMs} ms），强制开始采集（数据可能不准确）`);
          } else {
            log(`  → 转台已到位`);
          }
        }

        // ---- 采集 N 帧 B 帧（frames=0 时跳过，结果填 0） ----
        let avgFwj = 0;
        let avgFyj = 0;

        if (frames === 0) {
          log(`  → 采集帧数为 0，跳过数据采集，结果填 0`);
        } else {
          log(`  → 开始采集 ${frames} 帧 B 帧…`);
          let count  = 0;
          let sumFwj = 0;
          let sumFyj = 0;

          await new Promise((resolve, reject) => {
            setBFrameRawCallback((data) => {
              if (_calScanAbort) {
                setBFrameRawCallback(null);
                reject(new Error("abort"));
                return;
              }
              const view = new DataView(data.buffer, data.byteOffset);
              sumFwj += view.getFloat32(15, true) / 57.3;   // index9  FLOAT32 offset=15  scale=57.3
              sumFyj += view.getFloat32(19, true) / 57.3;   // index10 FLOAT32 offset=19  scale=57.3
              count++;
              if (count >= frames) {
                setBFrameRawCallback(null);
                resolve();
              }
            });
          }).catch((e) => {
            if (e.message !== "abort") throw e;
            setBFrameRawCallback(null);
            _calScanAbort = true;
          });

          if (_calScanAbort) {
            log("[校准扫描] 用户中止（采集期间）");
            setStatus("已中止", "orange");
            break;
          }

          avgFwj = +(sumFwj / frames).toFixed(6);
          avgFyj = +(sumFyj / frames).toFixed(6);
          log(`  → 采集完成：KFJ_FWJ=${avgFwj}°  KFJ_FYJ=${avgFyj}°`);
        }

        recordsFwj.push(`${txtAz},${txtEl},${avgFwj}`);
        recordsFyj.push(`${txtAz},${txtEl},${avgFyj}`);
      }
      if (_calScanAbort) break;
    }
  } finally {
    if (frames > 0 && !wasRunning) {
      stopSJCJF000H();
      log("[校准扫描] F000H 数据采集已自动停止");
    }
    setBFrameRawCallback(null);
    if (calBtnStart) calBtnStart.disabled = false;
    if (calBtnStop)  calBtnStop.disabled  = true;
  }

  if (_calScanAbort || recordsFwj.length === 0) {
    log("[校准扫描] 无有效数据，不保存文件");
    return;
  }


  // ---------- 保存结果 ----------
  setStatus("保存文件中…", "#7ec8f0");

  const header = "# turret_az, turret_el, kfj_angle";
  const fwjLines = [
    "# === 快反镜方位角  ===",
    header,
    ...recordsFwj,
  ];
  const fyjLines = [
    "# === 快反镜俯仰角  ===",
    header,
    ...recordsFyj,
  ];

  const now = new Date();
  const ts  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}_`
            + `${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}`;

  const fwjFilename = `cal_kfj_fwj_${ts}.txt`;
  const fyjFilename = `cal_kfj_fyj_${ts}.txt`;

  await saveLinesToTxtFile(fwjLines, fwjFilename);
  log(`[校准扫描] 已保存：${fwjFilename}`);

  await saveLinesToTxtFile(fyjLines, fyjFilename);
  log(`[校准扫描] 已保存：${fyjFilename}`);

  setStatus(`完成！共 ${recordsFwj.length} 个点，已保存`, "#7fc97f");
  log("[校准扫描] 全部完成。");
}

// ==================== Excel 位置序列扫描 ====================

/**
 * 从 B 帧接收表格（tableWidget_SJCJ_F000H_Recv）中按第 0 列的参数名称
 * 查找对应行，读取该行第 1 列（数值列）已显示的数值。
 *
 * 这样做的好处：协议修改导致字段的字节位置/位宽/比例系数发生变化时，
 * 只要 CSV 表头和 Command.js 的解析逻辑同步更新，这里不需要做任何改动。
 *
 * @param {string} fieldName  表格第 0 列中的参数名称，如 "快反镜方位角"
 * @returns {number|null}  解析出的数值；未找到或解析失败返回 null
 */
export function readBFrameTableValue(fieldName) {
  const table = document.getElementById("tableWidget_SJCJ_F000H_Recv");
  if (!table) {
    console.warn("[readBFrameTableValue] 找不到表格 tableWidget_SJCJ_F000H_Recv");
    return null;
  }
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (row.cells.length < 2) continue;
    const label = row.cells[0].textContent.trim();
    if (label === fieldName) {
      const cell  = row.cells[1];
      const input = cell.querySelector("input, select");
      const text  = input ? input.value.trim() : cell.textContent.trim();
      const val   = parseFloat(text);
      return isNaN(val) ? null : val;
    }
  }
  console.warn(`[readBFrameTableValue] 表格中未找到字段: "${fieldName}"`);
  return null;
}

/**
 * 弹出文件选择框，读取 Excel 文件（.xlsx / .xls / .csv），
 * 解析后返回二维数组 rows[][]（每行两个数值：方位、俯仰）。
 *
 * 解析策略：
 *   1. 若为 .csv 文件，直接按逗号/制表符分隔解析，跳过非数值行。
 *   2. 若为 .xlsx / .xls，尝试使用页面已加载的 SheetJS（XLSX 全局对象）；
 *      若 SheetJS 不可用则降级为按逗号分隔读取（视文件内容而定）。
 *
 * @returns {Promise<Array<[number,number]>|null>}
 *   解析成功返回 [[az0,el0],[az1,el1],...] ；用户取消或解析失败返回 null
 */
export function readExcelPositions() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }

      // 更新文件名显示
      const fnEl = document.getElementById("excel_scan_filename");
      if (fnEl) fnEl.textContent = file.name;

      const ext = file.name.split(".").pop().toLowerCase();

      if (ext === "csv") {
        // ---- CSV 路径：文本读取 ----
        const reader = new FileReader();
        reader.onload = (e) => resolve(_parseCsvRows(e.target.result));
        reader.onerror = () => resolve(null);
        reader.readAsText(file, "utf-8");
      } else {
        // ---- xlsx/xls 路径：二进制读取 ----
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const ab = e.target.result;
            // 优先使用 SheetJS（若页面已通过 <script> 引入）
            if (typeof XLSX !== "undefined") {
              const wb = XLSX.read(ab, { type: "array" });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
              resolve(_parseNumericRows(rawRows));
            } else {
              // 降级：把 ArrayBuffer 当文本尝试解析
              const text = new TextDecoder("utf-8").decode(new Uint8Array(ab));
              resolve(_parseCsvRows(text));
            }
          } catch (err) {
            console.error("[readExcelPositions] 解析失败:", err);
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
      }
    });

    input.addEventListener("cancel", () => resolve(null));
    document.body.appendChild(input);
    input.click();
    setTimeout(() => { try { document.body.removeChild(input); } catch (_) {} }, 10000);
  });
}

/** 将 CSV 文本解析为 [[az, el, An, Bn], ...] */
function _parseCsvRows(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return _parseNumericRows(lines.map((l) => l.split(/[,\t]/)));
}

/** 将二维字符串/数值数组过滤出含四个有效数值的行 [az, el, An, Bn] */
function _parseNumericRows(rawRows) {
  const result = [];
  for (const row of rawRows) {
    if (!row || row.length < 4) continue;
    const az = parseFloat(row[0]);
    const el = parseFloat(row[1]);
    const an = parseFloat(row[2]);
    const bn = parseFloat(row[3]);
    if (!isNaN(az) && !isNaN(el) && !isNaN(an) && !isNaN(bn))
      result.push([az, el, an, bn]);
  }
  return result.length > 0 ? result : null;
}

/**
 * 将结果生成两个 txt 文件并触发下载：
 *   格式：{{A1,B1,val1},{A2,B2,val2},...}  每 5 组换行
 *
 * @param {Array<{an:number, bn:number, fwj:number, fyj:number}>} results
 * @param {string} ts  时间戳字符串
 */
function downloadExcelScanResult(results, ts) {
  const GROUP_PER_LINE = 5;

  function buildTxt(valKey) {
    const entries = results.map((r) => `{${r.an},${r.bn},${r[valKey]}}`);
    const lines = [];
    for (let i = 0; i < entries.length; i += GROUP_PER_LINE) {
      lines.push(entries.slice(i, i + GROUP_PER_LINE).join(","));
    }
    return "{" + lines.join(",\n") + "}";
  }

  function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1500);
  }

  //triggerDownload(buildTxt("fwj"), `excel_scan_kfj_fwj_${ts}.txt`);
  //triggerDownload(buildTxt("fyj"), `excel_scan_kfj_fyj_${ts}.txt`);

  /*
   * 备选形式 1（当前注释，不生效）：只生成一个 txt
   * 每行一个数据项，字段之间使用空格：An Bn fwj fyj
   * 示例：
   * 1 10 2.3456 -0.1234
   * 2 20 2.3461 -0.1228
   *
   * 启用方法：注释掉上面当前生效的两行 triggerDownload，
   * 然后取消下面两行注释。
   */
  // const allContent = results
  //   .map((r) => `${r.an} ${r.bn} ${r.fwj} ${r.fyj}`)
  //   .join("\n");
  // triggerDownload(allContent, `excel_scan_kfj_fwj_fyj_${ts}.txt`);

  /*
   * 备选形式 2（当前注释，不生效）：生成两个 txt
   * 每行一个数据项，字段之间使用空格：An Bn 值
   * fwj 文件示例：
   * 1 10 2.3456
   * 2 20 2.3461
   * fyj 文件示例：
   * 1 10 -0.1234
   * 2 20 -0.1228
   *
   * 启用方法：注释掉上面当前生效的两行 triggerDownload，
   * 然后取消下面四行注释。
   */
   const fwjContent = results.map((r) => `${r.an} ${r.bn} ${r.fwj}`).join("\n");
   const fyjContent = results.map((r) => `${r.an} ${r.bn} ${r.fyj}`).join("\n");
   triggerDownload(fwjContent, `excel_scan_kfj_fwj_${ts}.txt`);
   triggerDownload(fyjContent, `excel_scan_kfj_fyj_${ts}.txt`);
}

/** Excel 扫描中止标志 */
let _excelScanAbort = false;

/**
 * Excel 位置序列扫描主函数（新版）：
 *   文件4列：az, el, An, Bn
 *   流程：转台到位 → 启动A帧 → 等待红外光轴系目标角度连续5帧<0.05°
 *         → 采集 frames 帧取快反镜均值 → 生成两个 txt 文件
 */
export async function runExcelScan() {
  const STABLE_COUNT  = 5;
  const STABLE_THRESH = 0.05;

  const frames  = Math.max(1, parseInt(document.getElementById("excel_scan_frames")?.value    ?? "100"));
  const waitMs  = Math.max(100, parseInt(document.getElementById("excel_scan_wait_ms")?.value ?? "3000"));

  const btnOpen  = document.getElementById("excel_scan_btn_open");
  const btnStart = document.getElementById("excel_scan_btn_start");
  const btnStop  = document.getElementById("excel_scan_btn_stop");
  const statusEl = document.getElementById("excel_scan_status");
  const logEl    = document.getElementById("excel_scan_log");

  const LOG_MAX_LINES = 500;   // 日志超过此行数时清零，防止占用大量内存
  const setStatus = (msg, color = "#e0e0e0") => {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
  };
  const log = (msg) => {
    if (!logEl) return;
    // 超过上限时清零，并给出提示
    const cur = (logEl.textContent.match(/\n/g) || []).length;
    if (cur >= LOG_MAX_LINES) {
      logEl.textContent = "--- 日志已超过上限，自动清零 ---\n";
    }
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  };

  const positions = window._excelScanPositions;
  if (!positions || positions.length === 0) {
    setStatus("请先打开文件", "orange");
    return;
  }

  const total = positions.length;

  _excelScanAbort = false;
  if (btnOpen)  btnOpen.disabled  = true;
  if (btnStart) btnStart.disabled = true;
  if (btnStop)  btnStop.disabled  = false;
  if (logEl)    logEl.textContent = "";
  log(`[Excel扫描] 共 ${total} 个位置，每点采集 ${frames} 帧，稳定阈值 ${STABLE_THRESH}deg x ${STABLE_COUNT}帧，到位超时 ${waitMs} ms`);

  const results = [];   // { an, bn, fwj, fyj }

  // 确保 A 帧（F000H）已启动
  const wasRunning = getSJCJF000HRunning();
  if (!wasRunning) {
    startSJCJF000H();
    log("[Excel扫描] A帧数据采集已自动启动");
  }

  log(`[Excel扫描] 正在获取当前转台位置作为基准...`);
  setStatus("获取基准位置...", "#7ec8f0");
  const basePos = await queryActualPos(waitMs);
  if (_excelScanAbort) {
    log("[Excel扫描] 用户中止");
    setStatus("已中止", "orange");
    if (!wasRunning) stopSJCJF000H();
    if (btnOpen) btnOpen.disabled = false;
    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
    return;
  }
  let baseX = 0, baseY = 0;
  if (basePos) {
    baseX = basePos.az >= 140 ? basePos.az - 360 : basePos.az;
    baseY = basePos.el >= 140 ? basePos.el - 360 : basePos.el;
    log(`  -> 成功获取基准位置：方位=${baseX}°  俯仰=${baseY}°`);
  } else {
    log(`  ! 获取基准位置超时，使用默认值 0°`);
  }

  try {
    for (let i = 0; i < total; i++) {
      if (_excelScanAbort) { log("[Excel扫描] 用户中止"); setStatus("已中止", "orange"); break; }

      let [targetAz, targetEl, an, bn] = positions[i];
      // 叠加上初始的转台位置
      targetAz = +(targetAz + baseX).toFixed(6);
      targetEl = +(targetEl + baseY).toFixed(6);

      setStatus(`扫描中 ${i + 1}/${total}  az=${targetAz}  el=${targetEl}`, "#7ec8f0");
      log(`\n[第 ${i + 1}/${total} 点] 目标位置：方位=${targetAz}  俯仰=${targetEl}  A=${an}  B=${bn}`);

      // 发送位置指令
      tt_setPos(targetAz, targetEl);
      tt_run();
      log(`  -> 位置指令已发送，等待到位（超时 ${waitMs} ms）...`);

      // 等待到位
      const arrived = await waitForTurntableArrive(waitMs);
      if (_excelScanAbort) { log("[Excel扫描] 用户中止（等待期间）"); setStatus("已中止", "orange"); break; }
      if (!arrived) {
        log(`  ！等待到位超时（${waitMs} ms），继续执行（数据可能不准确）`);
      } else {
        log(`  -> 转台已到位`);
      }

      // 阶段1：等待红外光轴系目标角度稳定（连续 STABLE_COUNT 帧均 < STABLE_THRESH）
      log(`  -> 等待红外光轴系目标角度稳定（连续 ${STABLE_COUNT} 帧 < ${STABLE_THRESH} deg）...`);
      let stableCount = 0;

      await new Promise((resolve, reject) => {
        setBFrameRawCallback(() => {
          if (_excelScanAbort) { setBFrameRawCallback(null); reject(new Error("abort")); return; }
          const fyj = readBFrameTableValue("红外光轴系目标俯仰角");
          const fwj = readBFrameTableValue("红外光轴系目标方位角");
          if (fyj !== null && fwj !== null
              && Math.abs(fyj) < STABLE_THRESH
              && Math.abs(fwj) < STABLE_THRESH) {
            stableCount++;
            if (stableCount >= STABLE_COUNT) { setBFrameRawCallback(null); resolve(); }
          } else {
            stableCount = 0;
          }
        });
      }).catch((e) => {
        if (e.message !== "abort") throw e;
        setBFrameRawCallback(null);
        _excelScanAbort = true;
      });

      if (_excelScanAbort) { log("[Excel扫描] 用户中止（等待稳定期间）"); setStatus("已中止", "orange"); break; }
      log(`  -> 红外光轴系目标角度已稳定，开始采集 ${frames} 帧...`);

      // 阶段2：采集 frames 帧，取快反镜方位角/俯仰角均值
      let count = 0, sumFwj = 0, sumFyj = 0, warnFwj = false, warnFyj = false;

      await new Promise((resolve, reject) => {
        setBFrameRawCallback(() => {
          if (_excelScanAbort) { setBFrameRawCallback(null); reject(new Error("abort")); return; }
          const vFwj = readBFrameTableValue("快反镜方位角");
          const vFyj = readBFrameTableValue("快反镜俯仰角");
          if (vFwj === null) { warnFwj = true; } else { sumFwj += vFwj; }
          if (vFyj === null) { warnFyj = true; } else { sumFyj += vFyj; }
          count++;
          if (count >= frames) { setBFrameRawCallback(null); resolve(); }
        });
      }).catch((e) => {
        if (e.message !== "abort") throw e;
        setBFrameRawCallback(null);
        _excelScanAbort = true;
      });

      if (_excelScanAbort) { log("[Excel扫描] 用户中止（采集期间）"); setStatus("已中止", "orange"); break; }

      const avgFwj = (warnFwj || count === 0) ? 0 : +(sumFwj / count).toFixed(6);
      const avgFyj = (warnFyj || count === 0) ? 0 : +(sumFyj / count).toFixed(6);
      if (warnFwj) log("  ! 未找到快反镜方位角字段，填 0");
      if (warnFyj) log("  ! 未找到快反镜俯仰角字段，填 0");
      log(`  -> 采集完成（${count} 帧）：快反镜方位角=${avgFwj}  快反镜俯仰角=${avgFyj}`);

      results.push({ an, bn, fwj: avgFwj, fyj: avgFyj });
    }
  } finally {
    setBFrameRawCallback(null);
    if (!wasRunning) {
      stopSJCJF000H();
      log("[Excel扫描] A帧数据采集已自动停止");
    }
    if (btnOpen)  btnOpen.disabled  = false;
    if (btnStart) btnStart.disabled = false;
    if (btnStop)  btnStop.disabled  = true;
  }

  if (_excelScanAbort || results.length === 0) {
    log("[Excel扫描] 无有效数据，不生成文件");
    return;
  }

  setStatus("生成结果文件...", "#7ec8f0");
  const now = new Date();
  const ts  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}_`
            + `${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}`;
  downloadExcelScanResult(results, ts);
  log(`[Excel扫描] 已生成并下载：excel_scan_kfj_fwj_${ts}.txt  /  excel_scan_kfj_fyj_${ts}.txt`);
  setStatus(`完成！共 ${results.length} 个点，结果已下载`, "#7fc97f");
  log("[Excel扫描] 全部完成。");
}
