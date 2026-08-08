import type { WsBus } from "./ws-bus";
import TcpBridge from "./TcpBridge";
import UdpBridge from "./js/Udp";

/**
 * bridges 模块：3 路 UDP/TCP 桥接装配（事件监听 + init + close）。
 * 逐字搬迁自 server.ts Bridge 1/2/3。
 * TcpBridge/UdpBridge 自身 @ts-nocheck 类型不完整，实例用 any。
 */

export interface BridgeConfig {
  useTcp: boolean;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
}

export interface BridgesOptions {
  wsBus: WsBus;
  bridges: [BridgeConfig, BridgeConfig, BridgeConfig];
  /** Bridge 1 ready 回调（server.ts 用于设 udpReady 状态，供 connection handler 用） */
  onBridge1Ready?: () => void;
}

export interface BridgesController {
  close(): void;
  /** 转发图像上传二进制到 Bridge 3（图像上传 UDP） */
  sendImageUpload(buf: Buffer): void;
  /** 转发到 Bridge 1（主通信 UDP/TCP） */
  sendToBridge1(buf: Buffer): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBridge = any;

export function createBridges(opts: BridgesOptions): BridgesController {
  const { wsBus, bridges, onBridge1Ready } = opts;

  // --- Bridge 1 ---
  const udpBridge: AnyBridge = bridges[0].useTcp ? new TcpBridge() : new UdpBridge();

  udpBridge.on("ready", () => {
    console.log("✅ UDP ready");
    console.log("   准备广播 udp_ready 消息...");
    onBridge1Ready?.();
    wsBus.broadcast({ type: "udp_ready", message: "UDP connection established" });
    console.log("   已广播 udp_ready 消息，当前连接客户端数:", wsBus.clients.size);
  });

  udpBridge.on("rs485", (info: AnyBridge) => {
    wsBus.broadcast({
      type: "rs485",
      flag: info.flag,
      name: info.name,
      data: info.data ? info.data.toString("hex") : null,
      meta: info.meta || null,
    });
  });

  udpBridge.on("heixiazi", (info: AnyBridge) => {
    const packet = Buffer.allocUnsafe(1 + info.data.length);
    packet[0] = 0x03;
    info.data.copy(packet, 1);
    wsBus.broadcastBinary(packet);
  });

  udpBridge.on("YC", (info: AnyBridge) => {
    const packet = Buffer.allocUnsafe(1 + info.data.length);
    packet[0] = 0x04;
    info.data.copy(packet, 1);
    wsBus.broadcastBinary(packet);
  });

  udpBridge.on("laser_data", (data: Buffer) => {
    wsBus.broadcast({ type: "laser_data", data: data.toString("hex") });
  });

  udpBridge.on("chart_update", (data: Buffer) => {
    wsBus.broadcast({ type: "chart_update", data: data.toString("hex") });
  });

  udpBridge.on("SJCJ_trigger", () => {
    wsBus.broadcast({ type: "SJCJ_trigger" });
  });

  udpBridge.on("received", (info: AnyBridge) => {
    console.log("📩 UDP 收到数据，准备广播...");
    wsBus.broadcast({ type: "udp_received", data: info.data.toString("hex"), from: info.from });
  });

  udpBridge.on("sent", (buffer: Buffer) => {
    console.log("📤 UDP 发送成功，准备广播...");
    wsBus.broadcast({ type: "udp_sent", length: buffer.length });
  });

  udpBridge.on("error", (err: Error) => {
    console.error("❌ UDP 错误:", err.message);
    wsBus.broadcast({ type: "udp_error", error: err.message });
  });

  console.log("🔧 正在初始化 UDP...");
  udpBridge.init(bridges[0].localIp, bridges[0].localPort, bridges[0].remoteIp, bridges[0].remotePort, "udp");

  // --- Bridge 2 ---
  const udpBridge2: AnyBridge = bridges[1].useTcp ? new TcpBridge() : new UdpBridge();

  udpBridge2.on("ready", () => {
    console.log("✅ Bridge2 ready");
    wsBus.broadcast({ type: "udp2_ready", message: "Bridge2 connected" });
  });

  udpBridge2.on("rs485", (info: AnyBridge) => {
    wsBus.broadcast({
      type: "rs485_2", flag: info.flag, name: info.name,
      data: info.data ? info.data.toString("hex") : null,
      meta: info.meta || null,
    });
  });

  udpBridge2.on("heixiazi", (info: AnyBridge) => {
    const packet = Buffer.allocUnsafe(1 + info.data.length);
    packet[0] = 0x03;
    info.data.copy(packet, 1);
    wsBus.broadcastBinary(packet);
  });

  udpBridge2.on("YC", (info: AnyBridge) => {
    const packet = Buffer.allocUnsafe(1 + info.data.length);
    packet[0] = 0x04;
    info.data.copy(packet, 1);
    wsBus.broadcastBinary(packet);
  });

  udpBridge2.on("laser_data", (data: Buffer) => {
    wsBus.broadcast({ type: "laser_data_2", data: data.toString("hex") });
  });

  udpBridge2.on("error", (err: Error) => {
    console.error("❌ Bridge2 错误:", err.message);
  });

  // 转台上行 ASCII 帧透传给前端
  udpBridge2.on("raw_text", (text: string) => {
    wsBus.broadcast({ type: "turntable_reply", text });
  });

  udpBridge2.init(bridges[1].localIp, bridges[1].localPort, bridges[1].remoteIp, bridges[1].remotePort, "udp");

  // --- Bridge 3 ---
  const udpBridge3: AnyBridge = bridges[2].useTcp ? new TcpBridge() : new UdpBridge();

  udpBridge3.on("ready", () => {
    console.log("✅ Bridge3 ready");
    wsBus.broadcastImg({ type: "udp3_ready", message: "Bridge3 connected" });
  });

  udpBridge3.on("heixiazi", (info: AnyBridge) => {
    const packet = Buffer.allocUnsafe(1 + info.data.length);
    packet[0] = 0x03;
    info.data.copy(packet, 1);
    wsBus.broadcastBinary(packet);
  });

  udpBridge3.on("error", (err: Error) => {
    console.error("❌ Bridge3 错误:", err.message);
    wsBus.broadcastImg({ type: "udp3_error", error: err.message });
  });

  udpBridge3.init(bridges[2].localIp, bridges[2].localPort, bridges[2].remoteIp, bridges[2].remotePort, "udp");

  function close(): void {
    udpBridge.close();
    udpBridge2.close();
    udpBridge3.close();
  }

  return {
    close,
    sendImageUpload: (buf: Buffer) => udpBridge3.sendPacket(buf),
    sendToBridge1: (buf: Buffer) => udpBridge.sendPacket(buf),
  };
}
