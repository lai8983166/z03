import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Command.ts loadCommand_* 测试。
 *
 * 复杂度说明：loadCommand_SJCJ 内部用 `while (isSJCJRunning)` 循环发送 packet，
 * isSJCJRunning 是 module-level state（初始 false，由外部按钮设置），非 export 无法在测试中控制。
 * 因此本测试聚焦"防御性检查"行为（helper 未初始化时不抛错、不调 sendUdp）。
 *
 * 完整 packet 字节布局测试需要：
 * - 重构 Command.ts export isSJCJRunning（改业务代码，违反约束）
 * - 或通过外部按钮 handler 间接设置（复杂）
 * 留作未来工作。
 */

// ---- mock 所有 Command.ts 的 import ----
vi.mock("../main", () => ({
  Utils: {
    loadCSVToTable: vi.fn(),
    getEditableCellsAsPositionMap: vi.fn(() => new Map()),
    setEditableCells: vi.fn(),
    setTableCellText: vi.fn(),
    getTableCellText: vi.fn(() => ""),
    centerAlignTable: vi.fn(),
    stretchTableColumns: vi.fn(),
    setCellWidget: vi.fn(),
    setTableCellReadonly: vi.fn(),
    parseCSV: vi.fn(() => []),
    saveTableToCSV: vi.fn(),
  },
  setLEDStatus: vi.fn(),
}));

vi.mock("../js/BinaryTableHelper", () => ({
  default: {
    get: vi.fn(() => null), // 返回 null，触发防御性 return
    init: vi.fn(),
  },
}));

vi.mock("../js/Client", () => ({
  default: {
    sendUdp: vi.fn(),
    sendText: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock("../js/StatusBar", () => ({
  default: { sendMessage: vi.fn(), receiveMessage: vi.fn() },
}));

vi.mock("../js/ImageUpload", () => ({ triggerSJCJResolve: vi.fn() }));
vi.mock("../js/ImageUploadClient", () => ({
  default: { connect: vi.fn(), on: vi.fn(), off: vi.fn(), sendUdp: vi.fn() },
}));
vi.mock("../js/Video", () => ({
  setTargetBoxPosition: vi.fn(),
  initializeVideoStream: vi.fn(),
  initializeBinarizedStream: vi.fn(),
}));
vi.mock("../js/Laser", () => ({ updateLaserImage: vi.fn(), initializeLaserTables: vi.fn() }));

import { loadCommand_SJCJ } from "../js/Command";
import wsClient from "../js/Client";

describe("Command.loadCommand_SJCJ 防御性检查", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PacketManager.get 返回 null 时不抛错（提前 return）", async () => {
    await expect(loadCommand_SJCJ()).resolves.not.toThrow();
  });

  it("PacketManager.get 返回 null 时不调 wsClient.sendUdp", async () => {
    await loadCommand_SJCJ();
    expect(wsClient.sendUdp).not.toHaveBeenCalled();
  });
});
