import { describe, it, expect } from "vitest";
import { convert16to8bit, buildVideoFramePacket, buildBinarizedFramePacket } from "../video";

// 只测纯函数（不调 createVideo，避免 spawn ffmpeg）。零子进程/网络。

describe("convert16to8bit", () => {
  it("已知 min/max 归一化到 0/255", () => {
    // 2 像素 × 2 字节：值 0x0000(min) 与 0xFFFF(max)
    const frame16 = Buffer.alloc(4);
    frame16.writeUInt16LE(0x0000, 0);
    frame16.writeUInt16LE(0xffff, 2);
    const frame8 = convert16to8bit(frame16, 2);
    expect(frame8[0]).toBe(0); // min → 0
    expect(frame8[1]).toBe(255); // max → 255
  });

  it("range===0 时全部填充 128", () => {
    const frame16 = Buffer.alloc(4);
    frame16.writeUInt16LE(100, 0);
    frame16.writeUInt16LE(100, 2); // 两像素相同 → range 0
    const frame8 = convert16to8bit(frame16, 2);
    expect(frame8[0]).toBe(128);
    expect(frame8[1]).toBe(128);
  });

  it("中间值线性归一化（0/100/200 → 0/128/255）", () => {
    const frame16 = Buffer.alloc(6);
    frame16.writeUInt16LE(0, 0);
    frame16.writeUInt16LE(100, 2);
    frame16.writeUInt16LE(200, 4);
    const frame8 = convert16to8bit(frame16, 3);
    expect(frame8[0]).toBe(0); // 0 → 0
    expect(frame8[1]).toBe(127); // (100*255/200) 浮点 = 127.4999... → Math.round = 127
    expect(frame8[2]).toBe(255); // 200 → 255
  });
});

describe("buildVideoFramePacket", () => {
  it("红外包头 [0x01][W LE][H LE] + data", () => {
    const data = Buffer.from([0xaa, 0xbb]);
    const pkt = buildVideoFramePacket(data, 128, 64);
    expect(pkt[0]).toBe(0x01);
    expect(pkt.readUInt16LE(1)).toBe(128);
    expect(pkt.readUInt16LE(3)).toBe(64);
    expect(Array.from(pkt.slice(5))).toEqual([0xaa, 0xbb]);
  });
});

describe("buildBinarizedFramePacket", () => {
  it("二值化包头 [0x02][W LE][H LE] + data", () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    const pkt = buildBinarizedFramePacket(data, 128, 128);
    expect(pkt[0]).toBe(0x02);
    expect(pkt.readUInt16LE(1)).toBe(128);
    expect(pkt.readUInt16LE(3)).toBe(128);
    expect(Array.from(pkt.slice(5))).toEqual([0x01, 0x02, 0x03]);
  });
});
