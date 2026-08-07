// @ts-nocheck: 后端 .ts 由 .js 迁移而来，含大量动态 class 属性等 JS 模式，
// tsc 强制检查会报数以百计的类型错。本 change 聚焦"打通 tsx 运行能力"，
// 类型收紧留给后续 change（3b 配合模块拆分补声明时逐个移除本指令）。
import { spawn } from "child_process";
import http from "http";
import WebSocket from "ws";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import UdpBridge from "./js/Udp";
import TcpBridge from "./TcpBridge";
import { SerialPort } from "serialport";
import { loadConfig } from "./config";
import { createWsBus } from "./ws-bus";
import { createVideo } from "./video";

// ==================== 配置 ====================
// 所有运行时参数集中在 config.json，由 config.js 的 loadConfig 读取并校验。
// 值校准自原硬编码（行为不变），结构模板见 config.example.json。
const cfg = loadConfig("./config.json");

const HTTP_PORT = cfg.http.port;
const WS_PORT = cfg.ws.port;
const WS_PORT_IMG = cfg.ws.portImg; // 图像上传专用 WebSocket 端口

const USE_TCP = cfg.bridges[0].useTcp;

// UDP 配置
//const UDP_LOCAL_IP = "0.0.0.0"; // 监听所有网卡
//const UDP_LOCAL_PORT = 6000; // 本地端口
const UDP_LOCAL_IP = cfg.bridges[0].localIp;
const UDP_LOCAL_PORT = cfg.bridges[0].localPort; // 本地端口

const UDP_REMOTE_IP = cfg.bridges[0].remoteIp; // 目标设备 IP
//const UDP_REMOTE_IP = "127.0.0.1";
//const UDP_REMOTE_PORT = 5000; // 目标设备端口
const UDP_REMOTE_PORT = cfg.bridges[0].remotePort; // 目标设备端口
// UDP_REMOTE_PORT = 61440; // 目标设备端口
//const IMAGE_UPLOAD_REMOTE_PORT = 30041;
const IMAGE_UPLOAD_REMOTE_PORT = cfg.imageUpload.remotePort;
const IMAGE_UPLOAD_REMOTE_IP = cfg.imageUpload.remoteIp;

// ==================== HTTP 服务器====================
const server = http.createServer((req, res) => {
  let filePath = "." + req.url;
  if (filePath === "./") {
    filePath = "./index.html";
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpg",
    ".csv": "text/csv",
  };

  const contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404);
        res.end("404 Not Found");
      } else {
        res.writeHead(500);
        res.end("Server Error: " + error.code);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

server.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`\n🌐 HTTP Server: http://localhost:${HTTP_PORT}/`);
});

// ==================== WebSocket 服务器（由 ws-bus 创建）====================
const wsBus = createWsBus(WS_PORT, WS_PORT_IMG);
const { wss, wssImg, clients, imgClients } = wsBus;
wssImg.on("connection", (ws) => {
  console.log("\n✅ ImageUpload WebSocket client connected");
  imgClients.add(ws);

  ws.send(JSON.stringify({ type: "img_connected", message: "ImageUpload WS connected" }));

  ws.on("message", (message) => {
    // 所有来自前端的二进制消息直接转发到图像上传 UDP
    if (Buffer.isBuffer(message)) {
      // 尝试 JSON 解析（控制消息）
      try {
        const data = JSON.parse(message);
        console.log("[IMG-WS] 收到 JSON 控制消息:", data.type);
        // 如有需要可在此处理图像上传专属控制消息
      } catch (e) {
        // 非 JSON → 二进制 UDP 数据包，直接转发
        console.log(`[IMG-WS] 转发二进制到图像上传UDP (${message.length} 字节)`);
        udpBridge3.sendPacket(message);
      }
    }
  });

  ws.on("close", () => {
    console.log("🔌 ImageUpload WebSocket client disconnected");
    imgClients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("❌ ImageUpload WebSocket error:", err);
  });
});

// broadcastImg / broadcastBinary 由 ws-bus 提供（见 wsBus.broadcastImg / broadcastBinary）

let udpReady = false;
wss.on("connection", (ws) => {
  console.log("\n✅ WebSocket client connected");
  clients.add(ws);

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "WebSocket connected to UDP bridge",
    }),
  );

  // 如果 UDP 已经就绪，立即通知新客户端
  if (udpReady) {
    console.log("   UDP 已就绪，立即通知客户端");
    ws.send(
      JSON.stringify({
        type: "udp_ready",
        message: "UDP connection established",
      }),
    );
  }

  // 接收前端消息
  ws.on("message", (message) => {
    // 根据消息类型初步分流

    //console.log(mes);
    let messageStr = null;
    let messageBuffer = null;

    //console.log("message:::",message.mes_type);

    /*if (mes.type==="udp") {
      
      messageBuffer = mes.data;

        console.log("mes.data:::", typeof mes.data);
        console.log("mes:::", mes);
      
        
        udpBridge.sendPacket(messageBuffer);
      

    } else if (typeof mes.type === "string") {
        // 文本消息：期望是 JSON 控制命令
        let mes = message.toString();
        mes = JSON.parse(mes);
        messageStr = mes.action;

      // 空消息检查
      if (!messageStr || messageStr.trim().length === 0) {
        console.warn("⚠️ 收到空文本消息，忽略");
        return;
      }

      // 尝试解析 JSON
      try {
        const data = mes;
        console.log("📨 [WebSocket] JSON 消息:", data.type);

        // 处理各类控制消息
        handleJsonControlMessage(data, ws);

      } catch (e) {
        // 真正的异常：格式错误的 JSON
        console.error("❌ JSON 解析失败:", e.message);
        console.error("   消息内容:", messageStr.substring(0, 100));
        // 格式错误的 JSON 不转发到 UDP
      }

    } else {
        console.log(`server 转发数据 (${message.length} 字节)`);
        console.log(
            `   数据: ${message.slice(0, 32).toString("hex")}${message.length > 32 ? "..." : ""
            }`,
        );

        udpBridge.sendPacket(message);
    }*/
    // 优先检测视频帧保存魔术字节 (0xF0 前缀，非JSON)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf0) {
      if (isSavingVideo && videoStream) {
        videoStream.write(message.slice(1));
        videoFrameCount++;
      }
      return;
    }

    // 检测激光帧保存魔术字节 (0xF1 前缀)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf1) {
      if (isSavingJG && jgStream) {
        jgStream.write(message.slice(1));
        jgFrameCount++;
      }
      return;
    }

    // 检测黑匣子帧保存魔术字节 (0xF2 前缀)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf2) {
      if (isSavingBlackbox && blackboxStream) {
        blackboxStream.write(message.slice(1));
        blackboxFrameCount++;
      }
      return;
    }

    // 检测YC数据保存魔术字节 (0xF3 前缀)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf3) {
      if (isSavingYC && ycStream) {
        ycStream.write(message.slice(1));
        ycFrameCount++;
      }
      return;
    }

    try {
      const data = JSON.parse(message);
      console.log("[MSG] [WebSocket] 文本消息:", data.type);

      // 处理控制消息（如 ping/pong）
      handleJsonControlMessage(data, ws);
    } catch (e) {
      //console.log(`server 转发数据 (${message.length} 字节)`);
      /*console.log(
        `   数据: ${message.toString("hex")}${
          message.length > 32 ? "..." : ""
        }`,
      );*/

      udpBridge.sendPacket(message);
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket client disconnected");
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
});

// ==================== Bridge 配置 + 事件监听 + 初始化 ====================

// --- Bridge 1 ---
const udpBridge = USE_TCP ? new TcpBridge() : new UdpBridge();

udpBridge.on("ready", () => {
  console.log("✅ UDP ready");
  console.log("   准备广播 udp_ready 消息...");
  udpReady = true;
  wsBus.broadcast({
    type: "udp_ready",
    message: "UDP connection established",
  });
  console.log("   已广播 udp_ready 消息，当前连接客户端数:", clients.size);
});

udpBridge.on("rs485", (info) => {
  //console.log(`[Server] RS485 事件: flag=${info.flag}, name=${info.name}`);
  wsBus.broadcast({
    type: "rs485",
    flag: info.flag,
    name: info.name,
    data: info.data ? info.data.toString("hex") : null,
    meta: info.meta || null,
  });
});

udpBridge.on("heixiazi", (info) => {
  // 0x03 前缀 + 原始字节，走二进制通道
  const packet = Buffer.allocUnsafe(1 + info.data.length);
  packet[0] = 0x03;
  info.data.copy(packet, 1);
  wsBus.broadcastBinary(packet);
});

udpBridge.on("YC", (info) => {
  // 0x04 前缀 + 原始字节，走二进制通道
  const packet = Buffer.allocUnsafe(1 + info.data.length);
  packet[0] = 0x04;
  info.data.copy(packet, 1);
  wsBus.broadcastBinary(packet);
});

udpBridge.on("laser_data", (data) => {
  wsBus.broadcast({
    type: "laser_data",
    data: data.toString("hex"),
  });
});

udpBridge.on("chart_update", (data) => {
  wsBus.broadcast({
    type: "chart_update",
    data: data.toString("hex"),
  });
});

udpBridge.on("SJCJ_trigger", () => {
  wsBus.broadcast({ type: "SJCJ_trigger" });
});

udpBridge.on("received", (info) => {
  console.log("📩 UDP 收到数据，准备广播...");
  wsBus.broadcast({
    type: "udp_received",
    data: info.data.toString("hex"),
    from: info.from,
  });
});

udpBridge.on("sent", (buffer) => {
  console.log("📤 UDP 发送成功，准备广播...");
  wsBus.broadcast({
    type: "udp_sent",
    length: buffer.length,
  });
});

udpBridge.on("error", (err) => {
  console.error("❌ UDP 错误:", err.message);
  wsBus.broadcast({
    type: "udp_error",
    error: err.message,
  });
});

console.log("🔧 正在初始化 UDP...");
udpBridge.init(UDP_LOCAL_IP, UDP_LOCAL_PORT, UDP_REMOTE_IP, UDP_REMOTE_PORT,'udp');

// --- Bridge 2 ---
// 按需修改以下参数，USE_TCP2=true 用 TcpBridge，false 用 UdpBridge
const USE_TCP2 = cfg.bridges[1].useTcp;
const UDP2_LOCAL_IP   = cfg.bridges[1].localIp;
const UDP2_LOCAL_PORT = cfg.bridges[1].localPort;               // 本地监听端口（UDP 模式需要与 Bridge 1 不同）
const UDP2_REMOTE_IP  = cfg.bridges[1].remoteIp;      // 第二个设备的 IP
const UDP2_REMOTE_PORT = cfg.bridges[1].remotePort;              // 第二个设备的端口

const udpBridge2 = USE_TCP2 ? new TcpBridge() : new UdpBridge();

udpBridge2.on("ready", () => {
  console.log("✅ Bridge2 ready");
  wsBus.broadcast({ type: "udp2_ready", message: "Bridge2 connected" });
});

udpBridge2.on("rs485", (info) => {
  wsBus.broadcast({ type: "rs485_2", flag: info.flag, name: info.name,
    data: info.data ? info.data.toString("hex") : null,
    meta: info.meta || null });
});

udpBridge2.on("heixiazi", (info) => {
  const packet = Buffer.allocUnsafe(1 + info.data.length);
  packet[0] = 0x03;
  info.data.copy(packet, 1);
  wsBus.broadcastBinary(packet);
});

udpBridge2.on("YC", (info) => {
  const packet = Buffer.allocUnsafe(1 + info.data.length);
  packet[0] = 0x04;
  info.data.copy(packet, 1);
  wsBus.broadcastBinary(packet);
});

udpBridge2.on("laser_data", (data) => {
  wsBus.broadcast({ type: "laser_data_2", data: data.toString("hex") });
});

udpBridge2.on("error", (err) => {
  console.error("❌ Bridge2 错误:", err.message);
});

// 转台上行 ASCII 帧透传给前端
udpBridge2.on("raw_text", (text) => {
  wsBus.broadcast({ type: "turntable_reply", text });
});

udpBridge2.init(UDP2_LOCAL_IP, UDP2_LOCAL_PORT, UDP2_REMOTE_IP, UDP2_REMOTE_PORT,'udp');

// --- Bridge 3 ---
// 按需修改以下参数，USE_TCP3=true 用 TcpBridge，false 用 UdpBridge
const USE_TCP3 = cfg.bridges[2].useTcp;
const UDP3_LOCAL_IP   = cfg.bridges[2].localIp;
const UDP3_LOCAL_PORT = cfg.bridges[2].localPort;               // 本地监听端口
const UDP3_REMOTE_IP  = cfg.bridges[2].remoteIp;      // 第三个设备的 IP
const UDP3_REMOTE_PORT = cfg.bridges[2].remotePort;              // 第三个设备的端口

const udpBridge3 = USE_TCP3 ? new TcpBridge() : new UdpBridge();

udpBridge3.on("ready", () => {
  console.log("✅ Bridge3 ready");
  wsBus.broadcastImg({ type: "udp3_ready", message: "Bridge3 connected" });
});

udpBridge3.on("heixiazi", (info) => {
  const packet = Buffer.allocUnsafe(1 + info.data.length);
  packet[0] = 0x03;
  info.data.copy(packet, 1);
  wsBus.broadcastBinary(packet);
});

udpBridge3.on("error", (err) => {
  console.error("❌ Bridge3 错误:", err.message);
  wsBus.broadcastImg({ type: "udp3_error", error: err.message });
});

udpBridge3.init(UDP3_LOCAL_IP, UDP3_LOCAL_PORT, UDP3_REMOTE_IP, UDP3_REMOTE_PORT,'udp');

// ==================== 转台串口通信 ====================
// 串口号可在运行时通过前端界面动态修改（发送 SET_TURNTABLE_PORT 消息）
let TURNTABLE_SERIAL_PORT = cfg.turntable.serialPort;     // ← 可通过前端界面实时修改
const TURNTABLE_BAUD_RATE = cfg.turntable.baudRate;     // ← 根据实际波特率修改

let turntableSerial = null;
let turntableSerialBuf = "";            // 用于拼接不完整的 ASCII 行

/**
 * 初始化转台串口，打开后监听数据并广播给前端。
 * 每次收到 \n 结尾的完整行就作为一帧处理。
 */
function initTurntableSerial() {
  turntableSerial = new SerialPort({
    path: TURNTABLE_SERIAL_PORT,
    baudRate: TURNTABLE_BAUD_RATE,
    autoOpen: false,
  });

  turntableSerial.open((err) => {
    if (err) {
      console.error(`❌ 转台串口 ${TURNTABLE_SERIAL_PORT} 打开失败:`, err.message);
      wsBus.broadcast({ type: "turntable_serial_error", message: err.message });
      return;
    }
    console.log(`✅ 转台串口 ${TURNTABLE_SERIAL_PORT} 已打开，波特率 ${TURNTABLE_BAUD_RATE}`);
    wsBus.broadcast({ type: "turntable_serial_ready", port: TURNTABLE_SERIAL_PORT });
  });

  turntableSerial.on("data", (chunk) => {
    // chunk 是 Buffer，追加到缓冲区按行切割
    console.log("[Turntable Serial] 原始字节:", chunk.toString("hex"), `(${chunk.length}字节)`);
    turntableSerialBuf += chunk.toString("utf8");
    const lines = turntableSerialBuf.split("\n");
    // 最后一段可能不完整，留在缓冲区
    turntableSerialBuf = lines.pop();
    for (const line of lines) {
      const text = line.replace(/\r$/, "").trim();
      if (!text) continue;
      console.log("[Turntable Serial] 收到:", text);
      if (text.startsWith("$")) {
        wsBus.broadcast({ type: "turntable_reply", text });
      }
    }
  });

  turntableSerial.on("error", (err) => {
    console.error("❌ 转台串口错误:", err.message);
    wsBus.broadcast({ type: "turntable_serial_error", message: err.message });
  });

  turntableSerial.on("close", () => {
    console.warn("⚠️ 转台串口已关闭");
    wsBus.broadcast({ type: "turntable_serial_closed" });
  });
}

/**
 * 向转台串口写入数据（字节数组或 Buffer）。
 * 若串口未打开则打印警告并忽略。
 *
 * @param {Buffer|Uint8Array} buf
 */
function sendToTurntableSerial(buf) {
  if (!turntableSerial || !turntableSerial.isOpen) {
    console.warn("⚠️ 转台串口未打开，无法发送");
    return;
  }
  const text = buf.toString("utf8").replace(/\r\n$/, "\\r\\n");
  console.log("[Turntable Serial] 发送:", text);
  turntableSerial.write(buf, (err) => {
    if (err) console.error("❌ 转台串口写入失败:", err.message);
  });
}

// 启动串口（如需禁用可注释此行）
initTurntableSerial();

// broadcast 由 ws-bus 提供（见 wsBus.broadcast）

// ====================关闭 ====================
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  udpBridge.close();
  udpBridge2.close();
  udpBridge3.close();
  wsBus.close();
  server.close();
  process.exit(0);
});

console.log("\n📋 Server ready. Press Ctrl+C to stop.\n");

// ==================== RTSP 视频流配置 ====================
//const RTSP_URL = "rtsp://localhost:8554/live";
const RTSP_URL = cfg.video.rtspUrl;
const SRC_WIDTH = cfg.video.srcWidth; // 原始分辨率
const SRC_HEIGHT = cfg.video.srcHeight;
const BYTES_PER_PIXEL_16BIT = cfg.video.bytesPerPixel16bit;
const FRAME_SIZE_16BIT = SRC_HEIGHT * SRC_WIDTH * BYTES_PER_PIXEL_16BIT;
const FRAME_SIZE_8BIT = SRC_HEIGHT * SRC_WIDTH;
// ==================== RTSP 视频流（由 video 模块管理）====================
// video 模块封装红外 + 二值化两条 ffmpeg 流；onFrame16bit 回调解耦数据保存
// （isSavingVideo/videoStream/videoFrameCount 仍由 server.ts 管理，3b-3 迁）。
const video = createVideo({
  rtspUrl: cfg.video.rtspUrl,
  binarizedRtspUrl: cfg.video.binarizedRtspUrl,
  ffmpegPath: cfg.video.ffmpegPath,
  srcWidth: cfg.video.srcWidth,
  srcHeight: cfg.video.srcHeight,
  bytesPerPixel16bit: cfg.video.bytesPerPixel16bit,
  wsBus,
  onFrame16bit: (frame) => {
    if (isSavingVideo && videoStream) {
      videoStream.write(frame);
      videoFrameCount++;
    }
  },
  getBinarizedInvert: () => binarizedInvert,
  getIsStreamingBinarized: () => isStreamingBinarizedVideo,
});

// 服务器启动后自动启动视频流（当前注释，维持遗留"不接入"现状）
console.log("\n🎥 准备启动 RTSP 视频流监听...");
/*setTimeout(() => {
  video.startVideoStream();
}, 2000);*/

// 关闭时停止视频流
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  video.stopVideoStream();
  udpBridge.close();
  udpBridge2.close();
  udpBridge3.close();
  wsBus.close();
  server.close();
  process.exit(0);
});

// ==================== [新增] 数据保存模块 ====================
let isSavingSJCJ = false;
let cmdSendStream = null; // 保留（兼容旧引用，实际不再使用）
let cmdRecvStream = null; // 保留（兼容旧引用，实际不再使用）

// exceljs 双Sheet缓存
let _sjcjARows = [];   // A帧行缓存 [[val,val,...], ...]
let _sjcjBRows = [];   // B帧行缓存
let _sjcjHeaderA = []; // A帧表头
let _sjcjHeaderB = []; // B帧表头
let _sjcjFilename = ""; // 目标文件名

// 新增：视频流保存相关
let isSavingVideo = false;
let videoStream = null;
let videoFrameCount = 0;

// 新增：激光数据保存相关
let isSavingJG = false;
let jgStream = null;
let jgFrameCount = 0;

// 新增：黑匣子保存相关
let isSavingBlackbox = false;
let blackboxStream = null;
let blackboxFrameCount = 0;

// 新增：YC数据保存相关
let isSavingYC = false;
let ycStream = null;
let ycFrameCount = 0;

// 新增：遥测 Excel 保存相关（黑匣子）
let isSavingHeixiaziExcel = false;
let _heixiaziExcelRows = [];    // 行缓存 [[时间戳, val, val, ...], ...]
let _heixiaziExcelHeader = [];  // 表头
let _heixiaziExcelFilename = "";

// 准备保存目录
const DATA_DIR = path.join(__dirname, cfg.dataDir);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeSJCJExcelRow(row) {
  const values = Array.isArray(row) ? row : String(row ?? "").split(",");
  return values.map((value, index) => {
    if (index === 0) return value;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (trimmed === "") return value;

    const num = Number(trimmed);
    return Number.isFinite(num) ? num : value;
  });
}

/**
 * 启动数据保存
 */
function startSavingSJCJ(dynamicHeaderB, dynamicHeaderA) {
  if (isSavingSJCJ) return;

  const now = new Date();
  const cleanTime = now
    .toISOString()
    .replace(/T/, "-")
    .replace(/\..+/, "")
    .replace(/:/g, "-");

  _sjcjFilename = path.join(DATA_DIR, `数据采集AB帧_${cleanTime}.xlsx`);

  // 解析表头（CSV行格式 "字段1,字段2,..." 转数组）
  _sjcjHeaderA = dynamicHeaderA ? dynamicHeaderA.replace(/\n$/, "").split(",") : ["时间"];
  _sjcjHeaderB = dynamicHeaderB ? dynamicHeaderB.replace(/\n$/, "").split(",") : ["时间"];
  _sjcjARows = [];
  _sjcjBRows = [];

  isSavingSJCJ = true;
  console.log(`💾 [Server] 开始录制A/B帧 → ${_sjcjFilename}`);

  wsBus.broadcast({
    type: "SAVE_STATUS",
    status: "started",
    path: _sjcjFilename,
    pathA: _sjcjFilename,
    pathB: _sjcjFilename,
  });
}

/**
 * 停止保存，将缓存数据写入 xlsx（A帧/B帧各一个Sheet）
 */
async function stopSavingSJCJ() {
  if (!isSavingSJCJ) return;
  isSavingSJCJ = false;

  const aRows = _sjcjARows;
  const bRows = _sjcjBRows;
  const headerA = _sjcjHeaderA;
  const headerB = _sjcjHeaderB;
  const filename = _sjcjFilename;

  // 清空缓存
  _sjcjARows = [];
  _sjcjBRows = [];

  console.log(`💾 [Server] 停止录制，写入 xlsx: A帧${aRows.length}行 B帧${bRows.length}行`);

  try {
    const wb = new ExcelJS.Workbook();

    // ---- A帧 Sheet ----
    const wsA = wb.addWorksheet("A帧");
    wsA.addRow(headerA);
    for (const row of aRows) wsA.addRow(normalizeSJCJExcelRow(row));

    // ---- B帧 Sheet ----
    const wsB = wb.addWorksheet("B帧");
    wsB.addRow(headerB);
    for (const row of bRows) wsB.addRow(normalizeSJCJExcelRow(row));

    await wb.xlsx.writeFile(filename);
    console.log(`✅ [Server] 已保存: ${filename}`);
    wsBus.broadcast({ type: "SAVE_STATUS", status: "stopped", path: filename });
  } catch (err) {
    console.error("❌ 写入 xlsx 失败:", err);
    wsBus.broadcast({ type: "SAVE_STATUS", status: "error", msg: err.message });
  }
}

/**
 * 启动视频流保存
 * @param {string} [filePath] - 前端指定的保存路径（含文件名），不传则自动生成
 */
function startSavingVideo(filePath) {
  if (isSavingVideo) return; // 已经在保存

  try {
    let filename;
    if (filePath && filePath.trim() !== "") {
      filename = filePath.trim();
      // 目录不存在时自动创建
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } else {
      const now = new Date();
      const cleanTime = now
        .toISOString()
        .replace(/T/, "-")
        .replace(/\..+/, "")
        .replace(/:/g, "-");
      filename = path.join(DATA_DIR, `红外视频流_${cleanTime}.dat`);
    }

    // 创建写入流
    videoStream = fs.createWriteStream(filename, { flags: "w" });
    videoFrameCount = 0;

    isSavingVideo = true;
    console.log(`[Server] 开始录制视频流: ${filename}`);

    // 通知前端状态更新
    wsBus.broadcast({
      type: "SAVE_STATUS",
      saveType: "video",
      status: "started",
      path: filename,
    });
  } catch (err) {
    console.error("启动视频录制失败:", err);
    wsBus.broadcast({
      type: "SAVE_STATUS",
      saveType: "video",
      status: "error",
      msg: err.message,
    });
  }
}

/**
 * 停止视频流保存
 */
function stopSavingVideo() {
  if (!isSavingVideo) return;

  isSavingVideo = false;

  if (videoStream) {
    videoStream.end();
    videoStream = null;
  }

  console.log(`[Server] 停止录制视频流 (共保存 ${videoFrameCount} 帧)`);
  wsBus.broadcast({
    type: "SAVE_STATUS",
    saveType: "video",
    status: "stopped",
    frameCount: videoFrameCount,
  });

  videoFrameCount = 0;
}

/**
 * 启动激光数据保存
 * @param {string} [filePath] - 前端指定的保存路径（含文件名），不传则自动生成
 */
function startSavingJG(filePath) {
  if (isSavingJG) return; // 已经在保存

  try {
    let filename;
    if (filePath && filePath.trim() !== "") {
      filename = filePath.trim();
      // 目录不存在时自动创建
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } else {
      const now = new Date();
      const cleanTime = now
        .toISOString()
        .replace(/T/, "-")
        .replace(/\..+/, "")
        .replace(/:/g, "-");
      filename = path.join(DATA_DIR, `激光数据_${cleanTime}.dat`);
    }

    jgStream = fs.createWriteStream(filename, { flags: "w" });
    jgFrameCount = 0;

    isSavingJG = true;
    console.log(`[Server] 开始录制激光数据: ${filename}`);

    wsBus.broadcast({
      type: "SAVE_STATUS",
      saveType: "jg",
      status: "started",
      path: filename,
    });
  } catch (err) {
    console.error("启动激光数据录制失败:", err);
    wsBus.broadcast({
      type: "SAVE_STATUS",
      saveType: "jg",
      status: "error",
      msg: err.message,
    });
  }
}

/**
 * 停止激光数据保存
 */
function stopSavingJG() {
  if (!isSavingJG) return;

  isSavingJG = false;

  if (jgStream) {
    jgStream.end();
    jgStream = null;
  }

  console.log(`[Server] 停止录制激光数据 (共保存 ${jgFrameCount} 帧)`);
  wsBus.broadcast({
    type: "SAVE_STATUS",
    saveType: "jg",
    status: "stopped",
    frameCount: jgFrameCount,
  });

  jgFrameCount = 0;
}

/**
 * 启动黑匣子保存
 */
function startSavingBlackbox(filePath) {
  if (isSavingBlackbox) return;

  try {
    let filename;
    if (filePath && filePath.trim() !== "") {
      filename = filePath.trim();
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } else {
      const now = new Date();
      const cleanTime = now
        .toISOString()
        .replace(/T/, "-")
        .replace(/\..+/, "")
        .replace(/:/g, "-");
      filename = path.join(DATA_DIR, `黑匣子流_${cleanTime}.dat`);
    }

    blackboxStream = fs.createWriteStream(filename, { flags: "w" });
    blackboxFrameCount = 0;
    isSavingBlackbox = true;
    console.log(`[Server] 开始录制黑匣子流: ${filename}`);

    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "blackbox", status: "started", path: filename });
  } catch (err) {
    console.error("启动黑匣子保存失败:", err);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "blackbox", status: "error", msg: err.message });
  }
}

/**
 * 停止黑匣子保存
 */
function stopSavingBlackbox() {
  if (!isSavingBlackbox) return;

  isSavingBlackbox = false;

  if (blackboxStream) {
    blackboxStream.end();
    blackboxStream = null;
  }

  console.log(`[Server] 停止录制黑匣子流 (共保存 ${blackboxFrameCount} 帧)`);
  wsBus.broadcast({
    type: "SAVE_STATUS",
    saveType: "blackbox",
    status: "stopped",
    frameCount: blackboxFrameCount,
  });

  blackboxFrameCount = 0;
}

/**
 * 启动YC数据保存
 */
function startSavingYC(filePath) {
  if (isSavingYC) return;

  try {
    let filename;
    if (filePath && filePath.trim() !== "") {
      filename = filePath.trim();
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } else {
      const now = new Date();
      const cleanTime = now
        .toISOString()
        .replace(/T/, "-")
        .replace(/\..+/, "")
        .replace(/:/g, "-");
      filename = path.join(DATA_DIR, `YC数据_${cleanTime}.dat`);
    }

    ycStream = fs.createWriteStream(filename, { flags: "w" });
    ycFrameCount = 0;
    isSavingYC = true;
    console.log(`[Server] 开始录制YC数据: ${filename}`);

    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "yc", status: "started", path: filename });
  } catch (err) {
    console.error("启动YC数据录制失败:", err);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "yc", status: "error", msg: err.message });
  }
}

/**
 * 停止YC数据保存
 */
function stopSavingYC() {
  if (!isSavingYC) return;

  isSavingYC = false;

  if (ycStream) {
    ycStream.end();
    ycStream = null;
  }

  console.log(`[Server] 停止录制YC数据 (共保存 ${ycFrameCount} 帧)`);
  wsBus.broadcast({
    type: "SAVE_STATUS",
    saveType: "yc",
    status: "stopped",
    frameCount: ycFrameCount,
  });

  ycFrameCount = 0;
}

// ==================== 黑匣子遥测 Excel 保存 ====================

/**
 * 启动黑匣子遥测 Excel 保存（仅记录状态，表头由前端随后发来）
 * @param {string} filePath - 用户选择的保存路径（.xlsx）
 */
function startSavingHeixiaziExcel(filePath) {
  if (isSavingHeixiaziExcel) return;
  try {
    let filename = filePath && filePath.trim() !== "" ? filePath.trim() : (() => {
      const now = new Date();
      const t = now.toISOString().replace(/T/, "-").replace(/\..+/, "").replace(/:/g, "-");
      return path.join(DATA_DIR, `黑匣子遥测数据_${t}.xlsx`);
    })();

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    _heixiaziExcelFilename = filename;
    _heixiaziExcelRows = [];
    _heixiaziExcelHeader = [];
    isSavingHeixiaziExcel = true;

    console.log(`[Server] 开始录制黑匣子遥测 Excel: ${filename}`);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "heixiazi_excel", status: "started", path: filename });
  } catch (err) {
    console.error("启动黑匣子遥测 Excel 录制失败:", err);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "heixiazi_excel", status: "error", msg: err.message });
  }
}

/**
 * 停止黑匣子遥测 Excel 保存，将缓存行写入 xlsx
 */
function normalizeHeixiaziExcelRow(row) {
  if (!Array.isArray(row)) return row;
  return row.map((value, index) => {
    if (index === 0) return value; // 时间戳保留为文本
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (trimmed === "") return value;

    const num = Number(trimmed);
    return Number.isFinite(num) ? num : value;
  });
}

async function stopSavingHeixiaziExcel() {
  if (!isSavingHeixiaziExcel) return;
  isSavingHeixiaziExcel = false;

  const rows = _heixiaziExcelRows;
  const header = _heixiaziExcelHeader;
  const filename = _heixiaziExcelFilename;
  _heixiaziExcelRows = [];
  _heixiaziExcelHeader = [];

  console.log(`[Server] 停止录制黑匣子遥测 Excel，共 ${rows.length} 行，写入: ${filename}`);

  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("黑匣子遥测数据");

    if (header.length > 0) ws.addRow(header);
    for (const row of rows) ws.addRow(normalizeHeixiaziExcelRow(row));

    await wb.xlsx.writeFile(filename);
    console.log(`✅ [Server] 黑匣子遥测 Excel 已保存: ${filename}`);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "heixiazi_excel", status: "stopped", path: filename });
  } catch (err) {
    console.error("❌ 写入黑匣子遥测 Excel 失败:", err);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "heixiazi_excel", status: "error", msg: err.message });
  }
}

/**
 * 调用 PowerShell 弹出系统原生的文件保存对话框
 * 使用常驻预热 PowerShell 进程弹出文件保存对话框，避免每次冷启动的 1-2s 延迟。
 * @param {string} defaultName - 默认文件名
 * @param {string} filter      - 文件类型过滤（WinForms 格式）
 * @returns {Promise<string|null>} 用户选择的路径，取消时返回 null
 */

// ---- 常驻 PowerShell 进程（预热，消除冷启动延迟）----
let _psWorker = null;          // 常驻进程实例
let _psWorkerReady = false;    // 是否已完成预热
let _psWorkerBuf = "";         // stdout 缓冲
let _psWorkerErrBuf = "";      // stderr 缓冲
let _psWorkerPending = null;   // 当前等待中的 resolve
const _saveDialogLastDirs = new Map();
let _saveDialogLastDir = null;

// 常驻进程运行的循环脚本：启动后预加载 WinForms，然后循环等待 stdin 发来的 JSON 请求
const _psWorkerScript = `
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
# 导入 Win32 API，用于强制抢占前台焦点
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
# 预热完成，通知 Node
Write-Host "READY"
[Console]::Out.Flush()
# 循环处理请求
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  try {
    $req = $line | ConvertFrom-Json
  } catch { continue }
  # 创建一个屏幕中央的临时置顶窗口作为 owner，保证对话框弹到最前
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true
  $owner.FormBorderStyle = 'None'
  $owner.ShowInTaskbar = $false
  $owner.StartPosition = 'CenterScreen'
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Opacity = 0
  $owner.Show()
  # 用 Win32 API 强制将 owner 窗口抢占到前台
  $hwnd = $owner.Handle
  [Win32]::AllowSetForegroundWindow(-1) | Out-Null
  [Win32]::SetForegroundWindow($hwnd) | Out-Null
  $owner.Activate()
  $d = New-Object System.Windows.Forms.SaveFileDialog
  $d.Title = $req.title
  $d.FileName = $req.fileName
  $d.Filter = $req.filter
  if ($req.initialDirectory -and [System.IO.Directory]::Exists([string]$req.initialDirectory)) {
    $d.InitialDirectory = [string]$req.initialDirectory
  } else {
    $d.InitialDirectory = [Environment]::GetFolderPath('Desktop')
  }
  $d.OverwritePrompt = $true
  $result = $d.ShowDialog($owner)
  $owner.Dispose()
  if ($result -eq 'OK') { Write-Host $d.FileName } else { Write-Host 'CANCELLED' }
  [Console]::Out.Flush()
}
`.trim();

function _ensurePsWorker() {
  if (_psWorker && !_psWorker.killed) return;

  const encoded = Buffer.from(_psWorkerScript, "utf16le").toString("base64");
  _psWorkerReady = false;
  _psWorkerBuf = "";
  _psWorkerErrBuf = "";

  _psWorker = spawn("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", encoded,
  ]);

  _psWorker.stdout.on("data", (chunk) => {
    _psWorkerBuf += chunk.toString("utf8");
    // 按行处理
    const lines = _psWorkerBuf.split(/\r?\n/);
    _psWorkerBuf = lines.pop(); // 最后一段可能不完整，留到下次
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!_psWorkerReady) {
        if (trimmed === "READY") {
          _psWorkerReady = true;
          console.log("[Server] PowerShell 对话框工作进程已预热完毕");
        }
        continue;
      }
      // 这是对话框结果
      if (_psWorkerPending) {
        const resolve = _psWorkerPending;
        _psWorkerPending = null;
        resolve(trimmed === "CANCELLED" || trimmed.length === 0 ? null : trimmed);
      }
    }
  });

  _psWorker.stderr.on("data", (d) => {
    _psWorkerErrBuf += d.toString("utf8");
  });

  _psWorker.on("close", (code) => {
    if (_psWorkerErrBuf.trim()) console.error("[Server] PowerShell worker stderr:", _psWorkerErrBuf.trim());
    console.warn(`[Server] PowerShell 对话框工作进程已退出 (code=${code})，下次调用将自动重启`);
    _psWorker = null;
    _psWorkerReady = false;
    // 若有挂起请求，返回 null
    if (_psWorkerPending) {
      const resolve = _psWorkerPending;
      _psWorkerPending = null;
      resolve(null);
    }
  });

  _psWorker.on("error", (err) => {
    console.error("[Server] PowerShell worker 启动失败:", err);
    _psWorker = null;
    _psWorkerReady = false;
    if (_psWorkerPending) {
      const resolve = _psWorkerPending;
      _psWorkerPending = null;
      resolve(null);
    }
  });
}

// 服务启动时立即预热，消除第一次点击的延迟
_ensurePsWorker();

function getSaveDialogInitialDir(saveType) {
  const rememberedDir = saveType ? _saveDialogLastDirs.get(saveType) : null;
  const initialDir = rememberedDir || _saveDialogLastDir || DATA_DIR;
  return initialDir && fs.existsSync(initialDir) ? initialDir : null;
}

function rememberSaveDialogDir(saveType, filePath) {
  if (!filePath) return;
  const dir = path.dirname(filePath);
  if (!dir) return;
  _saveDialogLastDir = dir;
  if (saveType) _saveDialogLastDirs.set(saveType, dir);
}

function showSaveFileDialog(defaultName, filter, saveType) {
  return new Promise((resolve) => {
    // 若进程不存在（首次或崩溃重启），重新创建
    _ensurePsWorker();

    const initialDirectory = getSaveDialogInitialDir(saveType);
    const req = JSON.stringify({
      title:    "选择保存位置",
      fileName: (defaultName || "数据.dat"),
      filter:   (filter || "数据文件 (*.dat)|*.dat|所有文件 (*.*)|*.*"),
      initialDirectory,
    });

    const doSend = () => {
      _psWorkerPending = resolve;
      try {
        _psWorker.stdin.write(req + "\n", "utf8");
      } catch (e) {
        console.error("[Server] 写入 PowerShell worker 失败:", e);
        _psWorkerPending = null;
        resolve(null);
      }
    };

    if (_psWorkerReady) {
      doSend();
    } else {
      // 等待 READY 信号（最多 5 秒）
      const startTime = Date.now();
      const waitInterval = setInterval(() => {
        if (_psWorkerReady) {
          clearInterval(waitInterval);
          doSend();
        } else if (Date.now() - startTime > 5000) {
          clearInterval(waitInterval);
          console.error("[Server] PowerShell worker 预热超时");
          resolve(null);
        }
      }, 50);
    }
  });
}

/**
 * 处理 JSON 控制消息
 * @param {Object} data - 解析后的 JSON 数据
 * @param {WebSocket} ws - WebSocket 连接对象
 */
function handleJsonControlMessage(data, ws) {
  switch (data.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" }));
      break;

    case "SET_TURNTABLE_PORT": {
      // 前端发来 { type: "SET_TURNTABLE_PORT", port: "COMx" }
      const newPort = (data.port || "").trim().toUpperCase();
      if (!newPort) {
        ws.send(JSON.stringify({ type: "turntable_serial_error", message: "串口号不能为空" }));
        break;
      }
      console.log(`[Server] 收到 SET_TURNTABLE_PORT: ${newPort}`);
      // 关闭旧串口
      if (turntableSerial && turntableSerial.isOpen) {
        turntableSerial.close((err) => {
          if (err) console.warn("关闭旧串口时出错:", err.message);
        });
        turntableSerial = null;
      }
      TURNTABLE_SERIAL_PORT = newPort;
      initTurntableSerial();
      break;
    }

    case "REQUEST_SAVE_PATH":
      // 弹出原生文件保存对话框，取得路径后直接开始保存
      console.log("[Server] 收到 REQUEST_SAVE_PATH, saveType:", data.saveType, ", defaultName:", data.defaultName);
      showSaveFileDialog(data.defaultName || "数据.dat", data.filter, data.saveType).then((filePath) => {
        console.log("[Server] 对话框结果:", filePath);
        if (!filePath) {
          // 用户取消
          wsBus.broadcast({ type: "SAVE_STATUS", saveType: data.saveType, status: "cancelled" });
          return;
        }
        rememberSaveDialogDir(data.saveType, filePath);
        if (data.saveType === "video") {
          startSavingVideo(filePath);
        } else if (data.saveType === "jg") {
          startSavingJG(filePath);
        } else if (data.saveType === "blackbox") {
          startSavingBlackbox(filePath);
        } else if (data.saveType === "yc") {
          startSavingYC(filePath);
        } else if (data.saveType === "heixiazi_excel") {
          startSavingHeixiaziExcel(filePath);
        }
      });
      break;

    case "CONTROL_CMD":
      console.log("   [控制命令] action:", data.action);
      handleControlCommand(data);
      break;

    case "SAVE_B_FRAME_ROW":
      if (isSavingSJCJ) {
        // 将 CSV 行字符串解析为数组，推入 B帧缓存
        _sjcjBRows.push(normalizeSJCJExcelRow(data.row));
      }
      break;

    case "SAVE_A_FRAME_ROW":
      if (isSavingSJCJ) {
        // 将 CSV 行字符串解析为数组，推入 A帧缓存
        _sjcjARows.push(normalizeSJCJExcelRow(data.row));
      }
      break;

    case "HEIXIAZI_EXCEL_HEADER":
      // 前端在开始保存后发来表头
      if (isSavingHeixiaziExcel && data.header) {
        _heixiaziExcelHeader = data.header;
      }
      break;

    case "SAVE_HEIXIAZI_EXCEL_ROW":
      // 前端每帧发来一行遥测数据
      if (isSavingHeixiaziExcel && data.row) {
        _heixiaziExcelRows.push(data.row);
      }
      break;

    case "BINARIZED_PARAMS":
      // 处理二值化参数设置
      const needRestart =
        data.threshold !== undefined && data.threshold !== binarizedThreshold;

      if (data.threshold !== undefined) {
        binarizedThreshold = data.threshold;
      }
      if (data.invert !== undefined) {
        binarizedInvert = data.invert;
      }

      // 如果阈值改变了，需要重启 FFmpeg 进程
      if (needRestart) {
        video.restartBinarizedVideoStream();
      }
      break;

    default:
      console.warn("⚠️ 未知的 JSON 消息类型:", data.type);
  }
}

/**
 * 处理具体的控制命令
 * @param {Object} data - 控制命令数据
 */
function handleControlCommand(data) {
  switch (data.action) {
    case "START_SAVE_SJCJ":
      startSavingSJCJ(data.header, data.headerA);
      break;
    case "STOP_SAVE_SJCJ":
      stopSavingSJCJ();  // async，不阻塞主流程
      break;
    case "START_SAVE_VIDEO":
      startSavingVideo(data.filePath);
      break;
    case "STOP_SAVE_VIDEO":
      stopSavingVideo();
      break;
    case "START_SAVE_JG":
      startSavingJG(data.filePath);
      break;
    case "STOP_SAVE_JG":
      stopSavingJG();
      break;
    case "START_SAVE_BLACKBOX":
      startSavingBlackbox(data.filePath);
      break;
    case "STOP_SAVE_BLACKBOX":
      stopSavingBlackbox();
      break;
    case "START_SAVE_YC":
      startSavingYC(data.filePath);
      break;
    case "STOP_SAVE_YC":
      stopSavingYC();
      break;
    case "STOP_SAVE_HEIXIAZI_EXCEL":
      stopSavingHeixiaziExcel();
      break;
    case "START_BINARIZED_STREAM":
      video.startBinarizedVideoStream();
      isStreamingBinarizedVideo = true;
      break;
    case "STOP_BINARIZED_STREAM":
      video.stopBinarizedVideoStream();
      isStreamingBinarizedVideo = false;
      break;
    // ---- 转台串口转发 ----
    case "SEND_TO_BRIDGE2":
      // 前端发来 { type:"CONTROL_CMD", action:"SEND_TO_BRIDGE2", data:[...字节数组] }
      if (data.data) {
        sendToTurntableSerial(Buffer.from(data.data));
      }
      break;
    default:
      console.warn("⚠️ 未知的控制命令:", data.action);
  }
}

/**
 * 将二进制 buffer 格式化为 CSV 行并写入
 * (这里需要实现类似于 PacketManager 的解码逻辑，或者简化处理直接存 Hex?)
 * 根据 C++ 代码逻辑，它是写入 "解析后的数值"。
 * 如果我们在后端没有完整的 BinaryTableHelper 逻辑，
 * 最好的办法是：前端解析好 CSV 字符串发给后端存 (方案A)，
 * 或者后端只存 Hex 以后再处理 (方案B)。
 *
 * 鉴于前端已有 helper.updateAllToTable 解析逻辑，
 * 我们可以仅在后端做原始数据转存：
 */
function writeRecvDataToCsv(buffer) {
  // ⚠️ 注意：要在后端完美复刻 BinaryTableHelper 解析逻辑比较复杂
  // 这里暂时只写入 Hex 字符串或原始数据，或者根据项目需求
  // 如果必须存解析后的值，建议：前端收到 1000H 并在 Helper 解析后，
  // 把 CSV 行字符串通过 WebSocket 发回给 Server 保存。

  // 简单实现：只写入时间戳和 Hex
  if (cmdRecvStream) {
    cmdRecvStream.write(
      `${new Date().toISOString()},${buffer.toString("hex")}\n`,
    );
  }
}

// ==================== 二值化流状态（进程由 video 模块管理）====================
// isStreamingBinarizedVideo / binarizedThreshold / binarizedInvert 由 control 层
// （handleJsonControlMessage / handleControlCommand）管理；video 通过 getter 读。
let isStreamingBinarizedVideo = false;
let binarizedThreshold = 128; // 二值化阈值
let binarizedInvert = false; // 是否反转

// 二值化视频流函数（startBinarizedVideoStream / stopBinarizedVideoStream /
// broadcastBinarizedVideoFrame / restartBinarizedVideoStream）已迁 video 模块。

// 监听来自前端的二值化参数设置消息
// 在 ws.on("message") 中添加对二值化参数的处理
