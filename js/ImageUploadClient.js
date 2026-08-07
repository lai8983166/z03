/**
 * ImageUploadClient.js
 * 图像上传专用 WebSocket 客户端，连接后端 ws://host:8082。
 * 所有图像上传相关的 UDP 收发均通过此连接，与主通信链路（8081）完全隔离。
 *
 * 接收到的 rs485 消息（flag=19）直接分发给 ImageUpload.js 注册的处理函数。
 */

/** @type {((data: Uint8Array) => void) | null} 握手应答处理函数 */
let _onHandshakeAck = null;
/** @type {((data: Uint8Array) => void) | null} 每包应答处理函数 */
let _onPerFrameAck = null;

/**
 * 注册握手应答（flag=19, name=IMAGE_UPLOAD_0B00H, data[0..1]=0x15,0x06）回调
 * @param {(data: Uint8Array) => void} fn
 */
export function setOnHandshakeAck(fn) { _onHandshakeAck = fn; }

/**
 * 注册每包应答（flag=19, name=IMAGE_UPLOAD_0B00H, data[0..1]=0x40,0x06）回调
 * @param {(data: Uint8Array) => void} fn
 */
export function setOnPerFrameAck(fn) { _onPerFrameAck = fn; }

class ImageUploadWSClient {
  constructor() {
    const host = window.location.hostname || "192.168.10.2";
    this.url = `ws://${host}:8082`;
    this.ws = null;
    this.isConnected = false;
    this._subscribers = {};
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log("[IMG-WS] 图像上传 WebSocket 已连接 (ws:8082)");
      this._emit("connected");
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // 图像上传通道暂不期望收到二进制消息，忽略
        return;
      }
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          console.error("[IMG-WS] 消息解析失败:", e);
        }
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      console.log("[IMG-WS] 图像上传 WebSocket 断开，3秒后重连...");
      this._emit("disconnected");
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (err) => {
      console.error("[IMG-WS] WebSocket 错误:", err);
    };
  }

  _handleMessage(msg) {
    if (msg.type === "rs485" && msg.flag === 19) {
      const dataBytes = msg.data ? this._hexToBytes(msg.data) : null;
      if (!dataBytes || dataBytes.length < 2) return;

      // 区分握手应答(0x15,0x06)与每包应答(0x40,0x06)
      if (dataBytes[0] === 0x15 && dataBytes[1] === 0x06) {
        if (_onHandshakeAck) _onHandshakeAck(dataBytes);
      } else if (dataBytes[0] === 0x40 && dataBytes[1] === 0x06) {
        if (_onPerFrameAck) _onPerFrameAck(dataBytes);
      } else {
        console.warn("[IMG-WS] 收到未知 flag=19 消息，data[0..1]:",
          dataBytes[0].toString(16), dataBytes[1].toString(16));
      }
    } else if (msg.type === "img_connected" || msg.type === "img_udp_ready") {
      console.log("[IMG-WS]", msg.message || msg.type);
      this._emit(msg.type, msg);
    } else {
      // 其他消息（如 img_udp_error 等）
      this._emit(msg.type, msg);
    }
  }

  /**
   * 发送二进制 UDP 数据包（图像上传帧/握手包）
   * @param {Uint8Array} uint8Array
   * @returns {boolean}
   */
  sendUdp(uint8Array) {
    if (!this.isConnected || !this.ws) {
      console.error("[IMG-WS] 图像上传 WebSocket 未连接，无法发送");
      return false;
    }
    this.ws.send(uint8Array.buffer);
    return true;
  }

  on(event, callback) {
    if (!this._subscribers[event]) this._subscribers[event] = [];
    this._subscribers[event].push(callback);
  }

  off(event, callback) {
    if (!this._subscribers[event]) return;
    this._subscribers[event] = this._subscribers[event].filter((cb) => cb !== callback);
  }

  _emit(event, data) {
    if (this._subscribers[event]) {
      this._subscribers[event].forEach((cb) => cb(data));
    }
  }

  _hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
}

const imgUploadClient = new ImageUploadWSClient();
imgUploadClient.connect();

export default imgUploadClient;
