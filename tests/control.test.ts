import { describe, it, expect, vi, beforeEach } from "vitest";
import { createControl } from "../control";
import type { ControlOptions } from "../control";
import type { WebSocket } from "ws";

/**
 * control 模块路由测试：构造 mock opts，验证 msg → mock 调用映射。
 * 不接触真实端口/IP/串口/DOM。
 */

function makeMockOpts() {
  return {
    wsBus: {
      broadcast: vi.fn(),
      broadcastImg: vi.fn(),
    },
    data: {
      startSavingSJCJ: vi.fn(),
      stopSavingSJCJ: vi.fn(),
      startSavingVideo: vi.fn(),
      stopSavingVideo: vi.fn(),
      startSavingJG: vi.fn(),
      stopSavingJG: vi.fn(),
      startSavingBlackbox: vi.fn(),
      stopSavingBlackbox: vi.fn(),
      startSavingYC: vi.fn(),
      stopSavingYC: vi.fn(),
      startSavingHeixiaziExcel: vi.fn(),
      stopSavingHeixiaziExcel: vi.fn(),
      showSaveFileDialog: vi.fn(),
      rememberSaveDialogDir: vi.fn(),
      appendSjcjBRow: vi.fn(),
      appendSjcjARow: vi.fn(),
      appendHeixiaziRow: vi.fn(),
      setHeixiaziHeader: vi.fn(),
    },
    video: {
      startBinarizedVideoStream: vi.fn(),
      stopBinarizedVideoStream: vi.fn(),
      restartBinarizedVideoStream: vi.fn(),
    },
    turntable: {
      send: vi.fn(),
      setPort: vi.fn(),
    },
    binarized: {
      getInvert: vi.fn(() => false),
      setInvert: vi.fn(),
      getThreshold: vi.fn(() => 50),
      setThreshold: vi.fn(),
      getIsStreaming: vi.fn(() => false),
      setIsStreaming: vi.fn(),
    },
  };
}

function makeMockWs(): WebSocket {
  return { send: vi.fn() } as unknown as WebSocket;
}

describe("control.handleControlCommand 路由", () => {
  let opts: ReturnType<typeof makeMockOpts>;
  let handleControlCommand: (msg: Record<string, unknown>) => void;

  beforeEach(() => {
    opts = makeMockOpts();
    ({ handleControlCommand } = createControl(opts as unknown as ControlOptions));
  });

  it("START_SAVE_SJCJ → data.startSavingSJCJ(header, headerA)", () => {
    handleControlCommand({ action: "START_SAVE_SJCJ", header: ["h1"], headerA: ["ha"] });
    expect(opts.data.startSavingSJCJ).toHaveBeenCalledWith(["h1"], ["ha"]);
  });

  it("STOP_SAVE_SJCJ → data.stopSavingSJCJ", () => {
    handleControlCommand({ action: "STOP_SAVE_SJCJ" });
    expect(opts.data.stopSavingSJCJ).toHaveBeenCalled();
  });

  it("START_SAVE_VIDEO → data.startSavingVideo(filePath)", () => {
    handleControlCommand({ action: "START_SAVE_VIDEO", filePath: "/tmp/v.dat" });
    expect(opts.data.startSavingVideo).toHaveBeenCalledWith("/tmp/v.dat");
  });

  it("STOP_SAVE_VIDEO → data.stopSavingVideo", () => {
    handleControlCommand({ action: "STOP_SAVE_VIDEO" });
    expect(opts.data.stopSavingVideo).toHaveBeenCalled();
  });

  it("START_SAVE_JG / STOP_SAVE_JG", () => {
    handleControlCommand({ action: "START_SAVE_JG", filePath: "/tmp/j.dat" });
    expect(opts.data.startSavingJG).toHaveBeenCalledWith("/tmp/j.dat");
    handleControlCommand({ action: "STOP_SAVE_JG" });
    expect(opts.data.stopSavingJG).toHaveBeenCalled();
  });

  it("START_SAVE_BLACKBOX / STOP_SAVE_BLACKBOX", () => {
    handleControlCommand({ action: "START_SAVE_BLACKBOX", filePath: "/tmp/b.dat" });
    expect(opts.data.startSavingBlackbox).toHaveBeenCalledWith("/tmp/b.dat");
    handleControlCommand({ action: "STOP_SAVE_BLACKBOX" });
    expect(opts.data.stopSavingBlackbox).toHaveBeenCalled();
  });

  it("START_SAVE_YC / STOP_SAVE_YC", () => {
    handleControlCommand({ action: "START_SAVE_YC", filePath: "/tmp/y.dat" });
    expect(opts.data.startSavingYC).toHaveBeenCalledWith("/tmp/y.dat");
    handleControlCommand({ action: "STOP_SAVE_YC" });
    expect(opts.data.stopSavingYC).toHaveBeenCalled();
  });

  it("STOP_SAVE_HEIXIAZI_EXCEL → data.stopSavingHeixiaziExcel", () => {
    handleControlCommand({ action: "STOP_SAVE_HEIXIAZI_EXCEL" });
    expect(opts.data.stopSavingHeixiaziExcel).toHaveBeenCalled();
  });

  it("START_BINARIZED_STREAM → video.start + binarized.setIsStreaming(true)", () => {
    handleControlCommand({ action: "START_BINARIZED_STREAM" });
    expect(opts.video.startBinarizedVideoStream).toHaveBeenCalled();
    expect(opts.binarized.setIsStreaming).toHaveBeenCalledWith(true);
  });

  it("STOP_BINARIZED_STREAM → video.stop + binarized.setIsStreaming(false)", () => {
    handleControlCommand({ action: "STOP_BINARIZED_STREAM" });
    expect(opts.video.stopBinarizedVideoStream).toHaveBeenCalled();
    expect(opts.binarized.setIsStreaming).toHaveBeenCalledWith(false);
  });

  it("SEND_TO_BRIDGE2 有 data → turntable.send(Buffer.from(data))", () => {
    handleControlCommand({ action: "SEND_TO_BRIDGE2", data: [0x01, 0x02] });
    expect(opts.turntable.send).toHaveBeenCalledTimes(1);
    const buf = opts.turntable.send.mock.calls[0][0] as Buffer;
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x01);
    expect(buf[1]).toBe(0x02);
  });

  it("SEND_TO_BRIDGE2 无 data → turntable.send 不调", () => {
    handleControlCommand({ action: "SEND_TO_BRIDGE2" });
    expect(opts.turntable.send).not.toHaveBeenCalled();
  });

  it("未知 action → 不抛错（default 分支）", () => {
    expect(() => handleControlCommand({ action: "UNKNOWN_ACTION" })).not.toThrow();
  });
});

describe("control.handleJsonControlMessage 路由", () => {
  let opts: ReturnType<typeof makeMockOpts>;
  let handleJson: (msg: Record<string, unknown>, ws: WebSocket) => void;

  beforeEach(() => {
    opts = makeMockOpts();
    ({ handleJsonControlMessage: handleJson } = createControl(opts as unknown as ControlOptions));
  });

  it("ping → ws.send({type:'pong'})", () => {
    const ws = makeMockWs();
    handleJson({ type: "ping" }, ws);
    expect((ws as unknown as { send: (s: string) => void }).send).toHaveBeenCalledWith(
      JSON.stringify({ type: "pong" }),
    );
  });

  it("SET_TURNTABLE_PORT 有效 port → turntable.setPort(uppercase)", () => {
    handleJson({ type: "SET_TURNTABLE_PORT", port: "com8" }, makeMockWs());
    expect(opts.turntable.setPort).toHaveBeenCalledWith("COM8");
  });

  it("SET_TURNTABLE_PORT 空 port → ws.send(error) + 不调 setPort", () => {
    const ws = makeMockWs();
    handleJson({ type: "SET_TURNTABLE_PORT", port: "  " }, ws);
    expect(opts.turntable.setPort).not.toHaveBeenCalled();
    expect((ws as unknown as { send: (s: string) => void }).send).toHaveBeenCalled();
  });

  it("REQUEST_SAVE_PATH saveType=video 用户确认 → data.startSavingVideo", async () => {
    opts.data.showSaveFileDialog.mockResolvedValue("/tmp/v.dat");
    handleJson({ type: "REQUEST_SAVE_PATH", saveType: "video", defaultName: "v.dat" }, makeMockWs());
    await vi.waitFor(() => expect(opts.data.startSavingVideo).toHaveBeenCalledWith("/tmp/v.dat"));
    expect(opts.data.rememberSaveDialogDir).toHaveBeenCalledWith("video", "/tmp/v.dat");
  });

  it("REQUEST_SAVE_PATH saveType=jg → data.startSavingJG", async () => {
    opts.data.showSaveFileDialog.mockResolvedValue("/tmp/j.dat");
    handleJson({ type: "REQUEST_SAVE_PATH", saveType: "jg" }, makeMockWs());
    await vi.waitFor(() => expect(opts.data.startSavingJG).toHaveBeenCalledWith("/tmp/j.dat"));
  });

  it("REQUEST_SAVE_PATH saveType=blackbox → data.startSavingBlackbox", async () => {
    opts.data.showSaveFileDialog.mockResolvedValue("/tmp/b.dat");
    handleJson({ type: "REQUEST_SAVE_PATH", saveType: "blackbox" }, makeMockWs());
    await vi.waitFor(() => expect(opts.data.startSavingBlackbox).toHaveBeenCalledWith("/tmp/b.dat"));
  });

  it("REQUEST_SAVE_PATH saveType=yc → data.startSavingYC", async () => {
    opts.data.showSaveFileDialog.mockResolvedValue("/tmp/y.dat");
    handleJson({ type: "REQUEST_SAVE_PATH", saveType: "yc" }, makeMockWs());
    await vi.waitFor(() => expect(opts.data.startSavingYC).toHaveBeenCalledWith("/tmp/y.dat"));
  });

  it("REQUEST_SAVE_PATH saveType=heixiazi_excel → data.startSavingHeixiaziExcel", async () => {
    opts.data.showSaveFileDialog.mockResolvedValue("/tmp/h.xlsx");
    handleJson({ type: "REQUEST_SAVE_PATH", saveType: "heixiazi_excel" }, makeMockWs());
    await vi.waitFor(() => expect(opts.data.startSavingHeixiaziExcel).toHaveBeenCalledWith("/tmp/h.xlsx"));
  });

  it("REQUEST_SAVE_PATH 用户取消（filePath=null）→ broadcast cancelled + 不调 startSaving", async () => {
    opts.data.showSaveFileDialog.mockResolvedValue(null);
    handleJson({ type: "REQUEST_SAVE_PATH", saveType: "video" }, makeMockWs());
    await vi.waitFor(() => expect(opts.wsBus.broadcast).toHaveBeenCalled());
    expect(opts.data.startSavingVideo).not.toHaveBeenCalled();
    const payload = opts.wsBus.broadcast.mock.calls[0][0] as { status: string };
    expect(payload.status).toBe("cancelled");
  });

  it("CONTROL_CMD → 转发到 handleControlCommand", () => {
    const ws = makeMockWs();
    handleJson({ type: "CONTROL_CMD", action: "STOP_SAVE_VIDEO" }, ws);
    expect(opts.data.stopSavingVideo).toHaveBeenCalled();
  });

  it("SAVE_B_FRAME_ROW → data.appendSjcjBRow(row)", () => {
    handleJson({ type: "SAVE_B_FRAME_ROW", row: ["a", "b"] }, makeMockWs());
    expect(opts.data.appendSjcjBRow).toHaveBeenCalledWith(["a", "b"]);
  });

  it("SAVE_A_FRAME_ROW → data.appendSjcjARow(row)", () => {
    handleJson({ type: "SAVE_A_FRAME_ROW", row: ["a"] }, makeMockWs());
    expect(opts.data.appendSjcjARow).toHaveBeenCalledWith(["a"]);
  });

  it("HEIXIAZI_EXCEL_HEADER → data.setHeixiaziHeader(header)", () => {
    handleJson({ type: "HEIXIAZI_EXCEL_HEADER", header: ["t", "v"] }, makeMockWs());
    expect(opts.data.setHeixiaziHeader).toHaveBeenCalledWith(["t", "v"]);
  });

  it("SAVE_HEIXIAZI_EXCEL_ROW → data.appendHeixiaziRow(row)", () => {
    handleJson({ type: "SAVE_HEIXIAZI_EXCEL_ROW", row: ["ts", 1] }, makeMockWs());
    expect(opts.data.appendHeixiaziRow).toHaveBeenCalledWith(["ts", 1]);
  });

  it("BINARIZED_PARAMS threshold 变化 → setThreshold + video.restart", () => {
    opts.binarized.getThreshold.mockReturnValue(50);
    handleJson({ type: "BINARIZED_PARAMS", threshold: 100, invert: true }, makeMockWs());
    expect(opts.binarized.setThreshold).toHaveBeenCalledWith(100);
    expect(opts.binarized.setInvert).toHaveBeenCalledWith(true);
    expect(opts.video.restartBinarizedVideoStream).toHaveBeenCalled();
  });

  it("BINARIZED_PARAMS threshold 不变 → 不 restart", () => {
    opts.binarized.getThreshold.mockReturnValue(50);
    handleJson({ type: "BINARIZED_PARAMS", threshold: 50 }, makeMockWs());
    expect(opts.video.restartBinarizedVideoStream).not.toHaveBeenCalled();
  });

  it("未知 type → 不抛错（default 分支）", () => {
    expect(() => handleJson({ type: "UNKNOWN_TYPE" }, makeMockWs())).not.toThrow();
  });
});
