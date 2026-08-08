import { describe, it, expect, beforeEach, vi } from "vitest";
// BinaryTableHelper class 未导出（只导出 PacketManager 单例），通过 mock fetch
// 让 PacketManager.init 拿到构造的 CSV，再 get() 取出 helper 测试——这样不改源文件。
import PacketManager from "../../js/BinaryTableHelper";

// 一行综合 CSV：u8/u16(带 scale)/u32/res/f32 各一个定义，字段名在定义左侧。
// offset: u8(1)@0, u16(2)@1, u32(4)@3, res(2)@7, f32(4)@9  → totalBytes = 13
const SAMPLE_CSV =
  "u8,0+UINT8+1,u16,1+UINT16+0.1,u32,2+UINT32+1,res,3+RES+2,f32,4+FLOAT+1";

let helper: any;

beforeEach(async () => {
  // mock fetch，对所有 URL 返回同一段 CSV（不读真实文件、不连网络）
  globalThis.fetch = vi.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    text: async () => SAMPLE_CSV,
  })) as unknown as typeof fetch;
  await PacketManager.init("./csv/");
  helper = PacketManager.get("SJCJ_Recv");
  // get() 在协议未加载时返回 null，但 init 后必然存在；确认一下
  expect(helper).not.toBeNull();
});

describe("BinaryTableHelper.parseLocData", () => {
  it("totalBytes 等于各字段 byteWidth 之和（1+2+4+2+4=13）", () => {
    expect(helper.totalBytes).toBe(13);
  });

  it("getIndexByName 按字段名查找", () => {
    expect(helper.getIndexByName("u8")).toBe(0);
    expect(helper.getIndexByName("u16")).toBe(1);
    expect(helper.getIndexByName("f32")).toBe(4);
    expect(helper.getIndexByName("不存在")).toBeNull();
  });

  it("RES 字段 getValue 返回空字符串", () => {
    expect(helper.getValue(3)).toBe("");
  });

  it("getBufferForSend 返回 totalBytes 长度的 Uint8Array", () => {
    const buf = helper.getBufferForSend();
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBe(13);
  });
});

describe("BinaryTableHelper.setValue/getValue 各类型", () => {
  it("UINT8 无 scale 读写一致", () => {
    helper.setValue(0, 200);
    expect(helper.getValue(0)).toBe("200");
  });

  it("UINT16 with scale 0.1：界面值 100 → 内存 10 → 读回 100", () => {
    helper.setValue(1, 100);
    expect(helper.getValue(1)).toBe("100");
  });

  it("UINT32 读写一致", () => {
    helper.setValue(2, 123456);
    expect(helper.getValue(2)).toBe("123456");
  });

  it("FLOAT32 with scale 1：2.5 读写一致", () => {
    helper.setValue(4, 2.5);
    expect(helper.getValue(4)).toBe("2.5");
  });

  it("setValueByName/getValueByName 按名操作", () => {
    helper.setValueByName("u16", 50);
    expect(helper.getValueByName("u16")).toBe("50");
  });

  it("RES/NOTUSE 的 setValue 直接返回 true（跳过写入）", () => {
    expect(helper.setValue(3, 123)).toBe(true);
    expect(helper.getValue(3)).toBe(""); // 仍是空
  });

  it("越界 index 的 setValue 返回 false", () => {
    expect(helper.setValue(999, 1)).toBe(false);
  });
});

describe("BinaryTableHelper.formatFloat", () => {
  it("整数返回无小数点", () => {
    expect(helper.formatFloat(3, 4)).toBe("3");
  });
  it("小数限 4 位（四舍五入）", () => {
    expect(helper.formatFloat(3.14159, 4)).toBe("3.1416");
  });
  it("2.5 保持一位小数", () => {
    expect(helper.formatFloat(2.5, 4)).toBe("2.5");
  });
});

describe("BinaryTableHelper buffer 操作", () => {
  it("loadBufferFromNet 覆盖 buffer 内容", () => {
    helper.setValue(0, 0);
    helper.loadBufferFromNet(new Uint8Array([0xaa, 0xbb, 0xcc]));
    const buf = helper.getBufferForSend();
    expect(buf[0]).toBe(0xaa);
    expect(buf[1]).toBe(0xbb);
  });

  it("getAllValues 返回非 RES/NOTUSE 字段值数组（跳过 index 3 的 RES）", () => {
    helper.setValue(0, 1);
    helper.setValue(1, 2);
    const all = helper.getAllValues();
    // index 0(u8),1(u16),2(u32),4(f32) → 4 个（跳过 index 3 RES）
    expect(all).toHaveLength(4);
  });

  it("copyTo 把指定字段字节拷贝到目标 buffer", () => {
    helper.setValue(0, 0xaa); // u8（scale 1），内存直接 0xaa
    const target = new Uint8Array(1);
    helper.copyTo(target, 0, 0, 1); // 从 index 0 拷 1 个定义项（u8, 1 字节）
    expect(target[0]).toBe(0xaa);
  });
});
