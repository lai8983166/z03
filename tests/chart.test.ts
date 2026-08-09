import { describe, it, expect, vi } from "vitest";
import {
  getChartFrameCounter,
  incrementChartFrameCounter,
  addChartDataPoint,
  setCurveVisible,
} from "../js/Chart";

/**
 * Chart.ts 纯函数测试：counter 与数据点管理。
 * 不接触真实 DOM canvas（不调 initializeChart）。
 */

describe("Chart counter", () => {
  it("getChartFrameCounter 返回 number（不抛错）", () => {
    expect(typeof getChartFrameCounter()).toBe("number");
  });

  it("incrementChartFrameCounter 不抛错", () => {
    expect(() => incrementChartFrameCounter()).not.toThrow();
  });

  it("increment 后 counter 增加 1（或达 maxPoints 重置）", () => {
    const before = getChartFrameCounter();
    incrementChartFrameCounter();
    const after = getChartFrameCounter();
    // 正常 +1，或 before=499 时重置为 0
    const expected = (before + 1) % 500;
    expect(after).toBe(expected);
  });

  it("increment 达 maxPoints 后重置（500 次完整周期回到起始值）", () => {
    // chartFrameCounter 是 module-level，跨测试共享。跑 500 次（一个完整周期）后回到起始值。
    const start = getChartFrameCounter();
    for (let i = 0; i < 500; i++) {
      incrementChartFrameCounter();
    }
    expect(getChartFrameCounter()).toBe(start);
  });
});

describe("Chart 数据点管理（chartData 未初始化）", () => {
  it("addChartDataPoint 未初始化时不抛错（curve 不存在 → console.warn）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => addChartDataPoint("unknown_curve", 0, 1.0, 100)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("setCurveVisible 未初始化时不抛错（curve 不存在 → 静默）", () => {
    expect(() => setCurveVisible("unknown_curve", true)).not.toThrow();
    expect(() => setCurveVisible("unknown_curve", false)).not.toThrow();
  });
});
