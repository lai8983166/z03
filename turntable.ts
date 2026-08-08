import { SerialPort } from "serialport";
import type { WsBus } from "./ws-bus";

/**
 * turntable 模块：转台串口通信（init/send/setPort/close + 数据行广播）。
 * 逐字搬迁自 server.ts initTurntableSerial/sendToTurntableSerial。
 */

export interface TurntableOptions {
  wsBus: WsBus;
  serialPort: string;
  baudRate: number;
}

export interface TurntableController {
  init(): void;
  send(buf: Buffer): void;
  setPort(port: string): void;
  close(): void;
}

export function createTurntable(opts: TurntableOptions): TurntableController {
  const { wsBus, baudRate } = opts;
  let TURNTABLE_SERIAL_PORT = opts.serialPort;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let turntableSerial: any = null;
  let turntableSerialBuf = "";

  function init(): void {
    turntableSerial = new SerialPort({
      path: TURNTABLE_SERIAL_PORT,
      baudRate: baudRate,
      autoOpen: false,
    });

    turntableSerial.open((err: Error | null | undefined) => {
      if (err) {
        console.error(`❌ 转台串口 ${TURNTABLE_SERIAL_PORT} 打开失败:`, err.message);
        wsBus.broadcast({ type: "turntable_serial_error", message: err.message });
        return;
      }
      console.log(`✅ 转台串口 ${TURNTABLE_SERIAL_PORT} 已打开，波特率 ${baudRate}`);
      wsBus.broadcast({ type: "turntable_serial_ready", port: TURNTABLE_SERIAL_PORT });
    });

    turntableSerial.on("data", (chunk: Buffer) => {
      console.log("[Turntable Serial] 原始字节:", chunk.toString("hex"), `(${chunk.length}字节)`);
      turntableSerialBuf += chunk.toString("utf8");
      const lines = turntableSerialBuf.split("\n");
      turntableSerialBuf = lines.pop() ?? "";
      for (const line of lines) {
        const text = line.replace(/\r$/, "").trim();
        if (!text) continue;
        console.log("[Turntable Serial] 收到:", text);
        if (text.startsWith("$")) {
          wsBus.broadcast({ type: "turntable_reply", text });
        }
      }
    });

    turntableSerial.on("error", (err: Error) => {
      console.error("❌ 转台串口错误:", err.message);
      wsBus.broadcast({ type: "turntable_serial_error", message: err.message });
    });

    turntableSerial.on("close", () => {
      console.warn("⚠️ 转台串口已关闭");
      wsBus.broadcast({ type: "turntable_serial_closed" });
    });
  }

  function send(buf: Buffer): void {
    if (!turntableSerial || !turntableSerial.isOpen) {
      console.warn("⚠️ 转台串口未打开，无法发送");
      return;
    }
    const text = buf.toString("utf8").replace(/\r\n$/, "\\r\\n");
    console.log("[Turntable Serial] 发送:", text);
    turntableSerial.write(buf, (err: Error | null | undefined) => {
      if (err) console.error("❌ 转台串口写入失败:", err.message);
    });
  }

  function setPort(port: string): void {
    if (turntableSerial && turntableSerial.isOpen) {
      turntableSerial.close((err: Error | null | undefined) => {
        if (err) console.warn("关闭旧串口时出错:", err.message);
      });
      turntableSerial = null;
    }
    TURNTABLE_SERIAL_PORT = port;
    init();
  }

  function close(): void {
    if (turntableSerial) {
      turntableSerial.close();
      turntableSerial = null;
    }
  }

  return { init, send, setPort, close };
}
