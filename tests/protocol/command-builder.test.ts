import { describe, it, expect } from "vitest";
import { buildPacket, bufferToHex } from "../../js/CommandBuilder.js";

describe("buildPacket", () => {
  it("空 payload 时构造 16 字节包头", () => {
    const pkt = buildPacket(0x00, 0x20, []);
    expect(pkt.length).toBe(16);
    // 固定头
    expect(pkt[0]).toBe(0x13);
    expect(pkt[1]).toBe(0x02);
    // 长度字段 [6-7] = payload.length + 2 = 2，小端
    expect(pkt[6]).toBe(2);
    expect(pkt[7]).toBe(0);
    // 地址位
    expect(pkt[12]).toBe(0x54);
    expect(pkt[13]).toBe(0x52);
    // 命令字
    expect(pkt[14]).toBe(0x00);
    expect(pkt[15]).toBe(0x20);
  });

  it("带 payload 时长度字段 = payload+2，payload 拼接到 [16..]", () => {
    const pkt = buildPacket(0xab, 0xcd, [0x01, 0x02, 0x03]);
    expect(pkt.length).toBe(19);
    expect(pkt[6]).toBe(5); // 3 + 2
    expect(pkt[7]).toBe(0);
    expect(pkt[14]).toBe(0xab);
    expect(pkt[15]).toBe(0xcd);
    expect(Array.from(pkt.slice(16))).toEqual([0x01, 0x02, 0x03]);
  });

  it("Uint8Array payload 与 Array payload 行为一致", () => {
    const fromArr = buildPacket(0x00, 0x00, [1, 2]);
    const fromU8 = buildPacket(0x00, 0x00, new Uint8Array([1, 2]));
    expect(Array.from(fromArr)).toEqual(Array.from(fromU8));
  });

  it("payload 默认为空（16 字节）", () => {
    const pkt = buildPacket(0x01, 0x02);
    expect(pkt.length).toBe(16);
    expect(pkt[14]).toBe(0x01);
    expect(pkt[15]).toBe(0x02);
  });

  it("大 payload（>255）时长度字段高位正确（小端）", () => {
    const payload = new Array(300).fill(0x41);
    const pkt = buildPacket(0x00, 0x00, payload);
    const lenVal = pkt[6] | (pkt[7] << 8); // 小端读回
    expect(lenVal).toBe(300 + 2);
    expect(pkt.length).toBe(16 + 300);
  });
});

describe("bufferToHex", () => {
  it("Uint8Array → 连续小写 hex 字符串", () => {
    expect(bufferToHex(new Uint8Array([0x13, 0x02, 0xab]))).toBe("1302ab");
  });

  it("空数组 → 空字符串", () => {
    expect(bufferToHex(new Uint8Array([]))).toBe("");
  });

  it("单字节补零", () => {
    expect(bufferToHex(new Uint8Array([0x0f]))).toBe("0f");
  });
});
