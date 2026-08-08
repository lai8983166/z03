import type { WsBus } from "./ws-bus";
import type { DataController } from "./data";
import type { VideoController } from "./video";
import type { WebSocket } from "ws";

/**
 * control 模块：消息路由（handleJsonControlMessage / handleControlCommand）。
 *
 * 参数命名为 msg（消息对象），避免与 data 模块实例冲突——3b-3a/3b-3b 曾因参数名 data
 * 与 data 模块同名导致前端发消息时崩（data.showSaveFileDialog 在消息对象上调用）。
 * 本 change 提取 control 时参数改 msg，data 模块方法走 opts.data，修复该 bug。
 */

export interface TurntableControl {
  send(buf: Buffer): void;
  setPort(port: string): void;
}

export interface BinarizedControl {
  getInvert(): boolean;
  setInvert(v: boolean): void;
  getThreshold(): number;
  setThreshold(v: number): void;
  getIsStreaming(): boolean;
  setIsStreaming(v: boolean): void;
}

export interface ControlOptions {
  wsBus: WsBus;
  data: DataController;
  video: VideoController;
  turntable: TurntableControl;
  binarized: BinarizedControl;
}

export interface ControlController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleJsonControlMessage(msg: any, ws: WebSocket): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleControlCommand(msg: any): void;
}

export function createControl(opts: ControlOptions): ControlController {
  const { wsBus, data, video, turntable, binarized } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleControlCommand(msg: any): void {
    switch (msg.action) {
      case "START_SAVE_SJCJ":
        data.startSavingSJCJ(msg.header, msg.headerA);
        break;
      case "STOP_SAVE_SJCJ":
        data.stopSavingSJCJ(); // async，不阻塞主流程
        break;
      case "START_SAVE_VIDEO":
        data.startSavingVideo(msg.filePath);
        break;
      case "STOP_SAVE_VIDEO":
        data.stopSavingVideo();
        break;
      case "START_SAVE_JG":
        data.startSavingJG(msg.filePath);
        break;
      case "STOP_SAVE_JG":
        data.stopSavingJG();
        break;
      case "START_SAVE_BLACKBOX":
        data.startSavingBlackbox(msg.filePath);
        break;
      case "STOP_SAVE_BLACKBOX":
        data.stopSavingBlackbox();
        break;
      case "START_SAVE_YC":
        data.startSavingYC(msg.filePath);
        break;
      case "STOP_SAVE_YC":
        data.stopSavingYC();
        break;
      case "STOP_SAVE_HEIXIAZI_EXCEL":
        data.stopSavingHeixiaziExcel();
        break;
      case "START_BINARIZED_STREAM":
        video.startBinarizedVideoStream();
        binarized.setIsStreaming(true);
        break;
      case "STOP_BINARIZED_STREAM":
        video.stopBinarizedVideoStream();
        binarized.setIsStreaming(false);
        break;
      // ---- 转台串口转发 ----
      case "SEND_TO_BRIDGE2":
        if (msg.data) {
          turntable.send(Buffer.from(msg.data));
        }
        break;
      default:
        console.warn("⚠️ 未知的控制命令:", msg.action);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleJsonControlMessage(msg: any, ws: WebSocket): void {
    switch (msg.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      case "SET_TURNTABLE_PORT": {
        // 前端发来 { type: "SET_TURNTABLE_PORT", port: "COMx" }
        const newPort = (msg.port || "").trim().toUpperCase();
        if (!newPort) {
          ws.send(JSON.stringify({ type: "turntable_serial_error", message: "串口号不能为空" }));
          break;
        }
        console.log(`[Server] 收到 SET_TURNTABLE_PORT: ${newPort}`);
        turntable.setPort(newPort);
        break;
      }

      case "REQUEST_SAVE_PATH":
        // 弹出原生文件保存对话框，取得路径后直接开始保存
        console.log("[Server] 收到 REQUEST_SAVE_PATH, saveType:", msg.saveType, ", defaultName:", msg.defaultName);
        data.showSaveFileDialog(msg.defaultName || "数据.dat", msg.filter, msg.saveType).then((filePath: string | null) => {
          console.log("[Server] 对话框结果:", filePath);
          if (!filePath) {
            // 用户取消
            wsBus.broadcast({ type: "SAVE_STATUS", saveType: msg.saveType, status: "cancelled" });
            return;
          }
          data.rememberSaveDialogDir(msg.saveType, filePath);
          if (msg.saveType === "video") {
            data.startSavingVideo(filePath);
          } else if (msg.saveType === "jg") {
            data.startSavingJG(filePath);
          } else if (msg.saveType === "blackbox") {
            data.startSavingBlackbox(filePath);
          } else if (msg.saveType === "yc") {
            data.startSavingYC(filePath);
          } else if (msg.saveType === "heixiazi_excel") {
            data.startSavingHeixiaziExcel(filePath);
          }
        });
        break;

      case "CONTROL_CMD":
        console.log("   [控制命令] action:", msg.action);
        handleControlCommand(msg);
        break;

      case "SAVE_B_FRAME_ROW":
        // 将 CSV 行字符串解析为数组，推入 B帧缓存
        data.appendSjcjBRow(msg.row);
        break;

      case "SAVE_A_FRAME_ROW":
        // 将 CSV 行字符串解析为数组，推入 A帧缓存
        data.appendSjcjARow(msg.row);
        break;

      case "HEIXIAZI_EXCEL_HEADER":
        // 前端在开始保存后发来表头
        data.setHeixiaziHeader(msg.header);
        break;

      case "SAVE_HEIXIAZI_EXCEL_ROW":
        // 前端每帧发来一行遥测数据
        data.appendHeixiaziRow(msg.row);
        break;

      case "BINARIZED_PARAMS": {
        // 处理二值化参数设置
        const needRestart =
          msg.threshold !== undefined && msg.threshold !== binarized.getThreshold();
        if (msg.threshold !== undefined) {
          binarized.setThreshold(msg.threshold);
        }
        if (msg.invert !== undefined) {
          binarized.setInvert(msg.invert);
        }
        // 如果阈值改变了，需要重启 FFmpeg 进程
        if (needRestart) {
          video.restartBinarizedVideoStream();
        }
        break;
      }

      default:
        console.warn("⚠️ 未知的 JSON 消息类型:", msg.type);
    }
  }

  return { handleJsonControlMessage, handleControlCommand };
}
