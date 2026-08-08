import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import type { WsBus } from "./ws-bus";

/**
 * data 模块：数据保存（4 类简单流式保存）+ 基础设施（PowerShell 文件对话框 + CSV 写）。
 *
 * 3b-3a 范围：基础设施 + Video/JG/Blackbox/YC 简单保存 + writeXxxFrame 接口。
 * SJCJ / Heixiazi Excel（复杂双 sheet）留 3b-3b 扩展进本模块。
 */

export interface DataOptions {
  wsBus: WsBus;
  dataDir: string; // 由 server.ts 计算 path.join(__dirname, cfg.dataDir) 后传入
}

export interface DataController {
  // 4 类简单保存
  startSavingVideo(filePath: string): void;
  stopSavingVideo(): void;
  startSavingJG(filePath: string): void;
  stopSavingJG(): void;
  startSavingBlackbox(filePath: string): void;
  stopSavingBlackbox(): void;
  startSavingYC(filePath: string): void;
  stopSavingYC(): void;
  // 帧写入接口（供 connection handler 的 0xF0-0xF3 + video onFrame16bit 调用）
  writeVideoFrame(frame: Buffer): void;
  writeJgFrame(frame: Buffer): void;
  writeBlackboxFrame(frame: Buffer): void;
  writeYcFrame(frame: Buffer): void;
  // 基础设施（SJCJ/Heixiazi 也复用 showSaveFileDialog）
  showSaveFileDialog(defaultName: string, filter: string, saveType: string): Promise<string | null>;
  rememberSaveDialogDir(saveType: string, filePath: string): void;
  writeRecvDataToCsv(buffer: Buffer): void;
}

// 常驻 PowerShell 进程运行的循环脚本（逐字搬迁自 server.ts _psWorkerScript）：
// 预加载 WinForms → 通知 READY → 循环读 stdin 的 JSON 请求 → 弹 SaveFileDialog → 回写路径。
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

export function createData(opts: DataOptions): DataController {
  const { wsBus, dataDir: DATA_DIR } = opts;

  // 保留（兼容旧引用，实际不再使用）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cmdSendStream: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cmdRecvStream: any = null;

  // 视频流保存
  let isSavingVideo = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let videoStream: any = null;
  let videoFrameCount = 0;

  // 激光数据保存
  let isSavingJG = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jgStream: any = null;
  let jgFrameCount = 0;

  // 黑匣子保存
  let isSavingBlackbox = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let blackboxStream: any = null;
  let blackboxFrameCount = 0;

  // YC 数据保存
  let isSavingYC = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ycStream: any = null;
  let ycFrameCount = 0;

  // PowerShell 文件对话框 worker 状态
  let _psWorker: ChildProcess | null = null;
  let _psWorkerReady = false;
  let _psWorkerBuf = "";
  let _psWorkerErrBuf = "";
  let _psWorkerPending: ((v: string | null) => void) | null = null;
  const _saveDialogLastDirs = new Map<string, string>();
  let _saveDialogLastDir: string | null = null;

  function _ensurePsWorker(): void {
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

    _psWorker.stdout!.on("data", (chunk: Buffer) => {
      _psWorkerBuf += chunk.toString("utf8");
      const lines = _psWorkerBuf.split(/\r?\n/);
      _psWorkerBuf = lines.pop() ?? "";
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
        if (_psWorkerPending) {
          const resolve = _psWorkerPending;
          _psWorkerPending = null;
          resolve(trimmed === "CANCELLED" || trimmed.length === 0 ? null : trimmed);
        }
      }
    });

    _psWorker.stderr!.on("data", (d: Buffer) => {
      _psWorkerErrBuf += d.toString("utf8");
    });

    _psWorker.on("close", (code: number) => {
      if (_psWorkerErrBuf.trim()) console.error("[Server] PowerShell worker stderr:", _psWorkerErrBuf.trim());
      console.warn(`[Server] PowerShell 对话框工作进程已退出 (code=${code})，下次调用将自动重启`);
      _psWorker = null;
      _psWorkerReady = false;
      if (_psWorkerPending) {
        const resolve = _psWorkerPending;
        _psWorkerPending = null;
        resolve(null);
      }
    });

    _psWorker.on("error", (err: Error) => {
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

  function getSaveDialogInitialDir(saveType: string): string | null {
    const rememberedDir = saveType ? _saveDialogLastDirs.get(saveType) ?? null : null;
    const initialDir = rememberedDir || _saveDialogLastDir || DATA_DIR;
    return initialDir && fs.existsSync(initialDir) ? initialDir : null;
  }

  function rememberSaveDialogDir(saveType: string, filePath: string): void {
    if (!filePath) return;
    const dir = path.dirname(filePath);
    if (!dir) return;
    _saveDialogLastDir = dir;
    if (saveType) _saveDialogLastDirs.set(saveType, dir);
  }

  function showSaveFileDialog(defaultName: string, filter: string, saveType: string): Promise<string | null> {
    return new Promise((resolve) => {
      _ensurePsWorker();
      const initialDirectory = getSaveDialogInitialDir(saveType);
      const req = JSON.stringify({
        title: "选择保存位置",
        fileName: defaultName || "数据.dat",
        filter: filter || "数据文件 (*.dat)|*.dat|所有文件 (*.*)|*.*",
        initialDirectory,
      });

      const doSend = () => {
        _psWorkerPending = resolve;
        try {
          _psWorker.stdin!.write(req + "\n", "utf8");
        } catch (e) {
          console.error("[Server] 写入 PowerShell worker 失败:", e);
          _psWorkerPending = null;
          resolve(null);
        }
      };

      if (_psWorkerReady) {
        doSend();
      } else {
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

  function writeRecvDataToCsv(buffer: Buffer): void {
    // 简单实现：只写入时间戳和 Hex（cmdRecvStream 当前为死状态，永不写入）
    if (cmdRecvStream) {
      cmdRecvStream.write(`${new Date().toISOString()},${buffer.toString("hex")}\n`);
    }
  }

  // ============ 4 类简单保存（逐字搬迁，模式一致，saveType + 文件名前缀不同）============

  function startSavingVideo(filePath: string): void {
    if (isSavingVideo) return;
    try {
      let filename: string;
      if (filePath && filePath.trim() !== "") {
        filename = filePath.trim();
        const dir = path.dirname(filename);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } else {
        const cleanTime = new Date().toISOString().replace(/T/, "-").replace(/\..+/, "").replace(/:/g, "-");
        filename = path.join(DATA_DIR, `红外视频流_${cleanTime}.dat`);
      }
      videoStream = fs.createWriteStream(filename, { flags: "w" });
      videoFrameCount = 0;
      isSavingVideo = true;
      console.log(`[Server] 开始录制视频流: ${filename}`);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "video", status: "started", path: filename });
    } catch (err) {
      const e = err as Error;
      console.error("启动视频录制失败:", e);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "video", status: "error", msg: e.message });
    }
  }

  function stopSavingVideo(): void {
    if (!isSavingVideo) return;
    isSavingVideo = false;
    if (videoStream) { videoStream.end(); videoStream = null; }
    console.log(`[Server] 停止录制视频流 (共保存 ${videoFrameCount} 帧)`);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "video", status: "stopped", frameCount: videoFrameCount });
    videoFrameCount = 0;
  }

  function startSavingJG(filePath: string): void {
    if (isSavingJG) return;
    try {
      let filename: string;
      if (filePath && filePath.trim() !== "") {
        filename = filePath.trim();
        const dir = path.dirname(filename);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } else {
        const cleanTime = new Date().toISOString().replace(/T/, "-").replace(/\..+/, "").replace(/:/g, "-");
        filename = path.join(DATA_DIR, `激光数据_${cleanTime}.dat`);
      }
      jgStream = fs.createWriteStream(filename, { flags: "w" });
      jgFrameCount = 0;
      isSavingJG = true;
      console.log(`[Server] 开始录制激光数据: ${filename}`);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "jg", status: "started", path: filename });
    } catch (err) {
      const e = err as Error;
      console.error("启动激光数据录制失败:", e);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "jg", status: "error", msg: e.message });
    }
  }

  function stopSavingJG(): void {
    if (!isSavingJG) return;
    isSavingJG = false;
    if (jgStream) { jgStream.end(); jgStream = null; }
    console.log(`[Server] 停止录制激光数据 (共保存 ${jgFrameCount} 帧)`);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "jg", status: "stopped", frameCount: jgFrameCount });
    jgFrameCount = 0;
  }

  function startSavingBlackbox(filePath: string): void {
    if (isSavingBlackbox) return;
    try {
      let filename: string;
      if (filePath && filePath.trim() !== "") {
        filename = filePath.trim();
        const dir = path.dirname(filename);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } else {
        const cleanTime = new Date().toISOString().replace(/T/, "-").replace(/\..+/, "").replace(/:/g, "-");
        filename = path.join(DATA_DIR, `黑匣子流_${cleanTime}.dat`);
      }
      blackboxStream = fs.createWriteStream(filename, { flags: "w" });
      blackboxFrameCount = 0;
      isSavingBlackbox = true;
      console.log(`[Server] 开始录制黑匣子流: ${filename}`);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "blackbox", status: "started", path: filename });
    } catch (err) {
      const e = err as Error;
      console.error("启动黑匣子保存失败:", e);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "blackbox", status: "error", msg: e.message });
    }
  }

  function stopSavingBlackbox(): void {
    if (!isSavingBlackbox) return;
    isSavingBlackbox = false;
    if (blackboxStream) { blackboxStream.end(); blackboxStream = null; }
    console.log(`[Server] 停止录制黑匣子流 (共保存 ${blackboxFrameCount} 帧)`);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "blackbox", status: "stopped", frameCount: blackboxFrameCount });
    blackboxFrameCount = 0;
  }

  function startSavingYC(filePath: string): void {
    if (isSavingYC) return;
    try {
      let filename: string;
      if (filePath && filePath.trim() !== "") {
        filename = filePath.trim();
        const dir = path.dirname(filename);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } else {
        const cleanTime = new Date().toISOString().replace(/T/, "-").replace(/\..+/, "").replace(/:/g, "-");
        filename = path.join(DATA_DIR, `YC数据_${cleanTime}.dat`);
      }
      ycStream = fs.createWriteStream(filename, { flags: "w" });
      ycFrameCount = 0;
      isSavingYC = true;
      console.log(`[Server] 开始录制YC数据: ${filename}`);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "yc", status: "started", path: filename });
    } catch (err) {
      const e = err as Error;
      console.error("启动YC数据录制失败:", e);
      wsBus.broadcast({ type: "SAVE_STATUS", saveType: "yc", status: "error", msg: e.message });
    }
  }

  function stopSavingYC(): void {
    if (!isSavingYC) return;
    isSavingYC = false;
    if (ycStream) { ycStream.end(); ycStream = null; }
    console.log(`[Server] 停止录制YC数据 (共保存 ${ycFrameCount} 帧)`);
    wsBus.broadcast({ type: "SAVE_STATUS", saveType: "yc", status: "stopped", frameCount: ycFrameCount });
    ycFrameCount = 0;
  }

  // ============ 帧写入接口（封装原 if (isSavingXxx && xxxStream) {...} 逻辑）============

  function writeVideoFrame(frame: Buffer): void {
    if (isSavingVideo && videoStream) { videoStream.write(frame); videoFrameCount++; }
  }
  function writeJgFrame(frame: Buffer): void {
    if (isSavingJG && jgStream) { jgStream.write(frame); jgFrameCount++; }
  }
  function writeBlackboxFrame(frame: Buffer): void {
    if (isSavingBlackbox && blackboxStream) { blackboxStream.write(frame); blackboxFrameCount++; }
  }
  function writeYcFrame(frame: Buffer): void {
    if (isSavingYC && ycStream) { ycStream.write(frame); ycFrameCount++; }
  }

  return {
    startSavingVideo, stopSavingVideo,
    startSavingJG, stopSavingJG,
    startSavingBlackbox, stopSavingBlackbox,
    startSavingYC, stopSavingYC,
    writeVideoFrame, writeJgFrame, writeBlackboxFrame, writeYcFrame,
    showSaveFileDialog,
    rememberSaveDialogDir,
    writeRecvDataToCsv,
  };
}
