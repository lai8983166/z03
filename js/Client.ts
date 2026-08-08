/* filepath: /home/lai/Public/project/25suo/2026-1-6/js/Client.js */
//import { handle_SJCJ_Recv_1000H } from "./Command";
import { handleRS485, handle_SJCJ_010203H } from "./DataHandler"; // 引入数据处理路由
import { handleVideoFrame, handleBinarizedFrame } from "./Video";
import { handle_YC_DATA_Per } from "./Telemeter";
import { handle_YC } from "./YC";

/** ws-bus 文本消息的通用 payload 形状 */
interface WsMessage {
  type: string;
  data?: string;
  flag?: number;
  name?: string;
  meta?: unknown;
  message?: string;
  [key: string]: unknown;
}

/** 事件回调签名 */
type EventCallback = (data: unknown) => void;

class WebSocketClient {
  url: string;
  ws: WebSocket | null;
  isConnected: boolean;
  subscribers: Record<string, EventCallback[]>;

  constructor() {
    // 自动使用当前页面的主机名连接 WebSocket，兼容本地测试和设备部署
    const host = window.location.hostname || "192.168.10.2";
      this.url = `ws://${host}:8081`;
      //this.url = "ws://192.168.10.2:8081";
    this.ws = null;
    this.isConnected = false;
    this.subscribers = {};
  }

  // 初始化并建立连接 (只会在启动时调用一次)
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log("[OK] WebSocket 已连接");
      this.emit("connected", { message: "Connection established" });
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryMessage(new Uint8Array(event.data));
        return;
      }
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          this.handleInternalMessage(msg);
        } catch (e) {
          console.error("[ERROR] 文本消息解析失败:", e);
        }
        return;
      }

      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buffer: ArrayBuffer) => {
          this.handleBinaryMessage(new Uint8Array(buffer));
        });
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      console.log("[WS] WebSocket 断开");
      this.emit("disconnected");
      setTimeout(() => this.connect(), 3000);
    };
  }

  handleInternalMessage(msg: WsMessage): void {
    console.debug("[RECV] Recv:", msg.type);

    // 直接调用 DataHandler 或分发事件
    if (msg.type === "rs485") {
      const dataBytes = msg.data ? this.hexToBytes(msg.data) : null;
      handleRS485(msg.flag!, msg.name!, dataBytes!, msg.meta as null);
    } else if (msg.type === "SJCJ_trigger") {
      handle_SJCJ_010203H();
    } else if (msg.type === "SAVE_STATUS") {

      this.emit(msg.type, msg);
    }
    else {
      this.emit(msg.type, msg);
    }
  }

  handleBinaryMessage(uint8Array: Uint8Array): void {
    // 检查视频帧标识: [0x01][W:2][H:2][Data...] 或 [0x02][W:2][H:2][Data...]
    if (uint8Array.length > 5) {
      const packetType = uint8Array[0];

      // 0x01 = 原始红外视频流
      if (packetType === 0x01) {
        const width = uint8Array[1] | (uint8Array[2] << 8);
        const height = uint8Array[3] | (uint8Array[4] << 8);
        const frameData = uint8Array.subarray(5);
        handleVideoFrame(frameData, width, height);
        return;
      }

      // 0x02 = 二值化视频流
      if (packetType === 0x02) {
        const width = uint8Array[1] | (uint8Array[2] << 8);
        const height = uint8Array[3] | (uint8Array[4] << 8);
        const frameData = uint8Array.subarray(5);
        handleBinarizedFrame(frameData, width, height);
        return;
      }

      // 0x03 = 黑匣子子包（原 heixiazi JSON 通道）
      if (packetType === 0x03) {
        handle_YC_DATA_Per(uint8Array.subarray(1));
        return;
      }

      // 0x04 = YC 遥测子包（原 YC JSON 通道）
      if (packetType === 0x04) {
        handle_YC(uint8Array.subarray(1));
        return;
      }
    }

    console.warn("收到未知二进制数据:", uint8Array.length, "字节");
  }

  // 发送 UDP 专用 (封装 hex)
  sendUdp(uint8Array: Uint8Array): boolean {
    if (!this.isConnected || !this.ws) {
      console.error("[ERROR] WebSocket 未连接");
      return false;
    }

    /*console.log(
      `client发送 UDP 数据 (${uint8Array.length} 字节):`,
      Array.from(uint8Array.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ") + (uint8Array.length > 32 ? "..." : ""),
    );*/

      /*const mes_package = { type: "udp", data: uint8Array.buffer };
      console.log(mes_package);*/

      this.ws.send(uint8Array as BufferSource);
    return true;
  }

  // 发送文本消息（JSON控制指令）
  sendText(text: string): boolean {
    if (!this.isConnected || !this.ws) {
      console.error("[ERROR] WebSocket 未连接");
      return false;
    }

      //console.log("text:::", typeof text);
      this.ws.send(text);
    return true;
  }

  // --- 简单的事件订阅/发布 ---
  on<T = unknown>(event: string, callback: (data: T) => void): void {
    if (!this.subscribers[event]) this.subscribers[event] = [];
    this.subscribers[event].push(callback as EventCallback);
  }

  off<T = unknown>(event: string, callback: (data: T) => void): void {
    if (!this.subscribers[event]) return;
    this.subscribers[event] = this.subscribers[event].filter((cb) => cb !== callback as EventCallback);
  }

  emit(event: string, data?: unknown): void {
    if (this.subscribers[event]) {
      this.subscribers[event].forEach((cb) => cb(data));
    }
  }

  hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
}

const wsInstance = new WebSocketClient();
export default wsInstance;
