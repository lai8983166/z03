import { describe, it, expect, beforeEach, vi } from "vitest";

// UdpBridge 构造函数会调 dgram.createSocket 创建 UDP socket，必须 mock dgram
// 才能保证测试不打开真实网络资源（_handleMessage 本身是纯解析，不碰 socket）。
vi.mock("dgram", () => ({
  default: {
    createSocket: vi.fn(() => ({
      on: vi.fn(),
      bind: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      address: vi.fn(() => ({ address: "0.0.0.0", port: 0 })),
    })),
  },
}));

import UdpBridge from "../../js/Udp";

// 构造符合 UdpBridge 协议的包头：[0]=0x13 [1]=0x02，[14]=cmd1 [15]=cmd2。
// SJCJ_trigger 分支检查 msg[12]==0x01 && msg[13]==0x02 && msg[14]==0x03。
function makePkt(opts: { cmd1?: number; cmd2?: number; payload?: number[]; trigger?: boolean } = {}): Buffer {
  const { cmd1 = 0, cmd2 = 0, payload = [], trigger = false } = opts;
  const buf = Buffer.alloc(16 + payload.length);
  buf[0] = 0x13;
  buf[1] = 0x02;
  buf[14] = cmd1;
  buf[15] = cmd2;
  if (trigger) {
    buf[12] = 0x01;
    buf[13] = 0x02;
    buf[14] = 0x03; // 覆盖 cmd1，触发 SJCJ_trigger 分支
  }
  for (let i = 0; i < payload.length; i++) buf[16 + i] = payload[i];
  return buf;
}

const RINFO = { address: "10.0.0.1", port: 30041 };

describe("UdpBridge._handleMessage", () => {
  let bridge: any;
  let events: { event: string; data: unknown }[];

  beforeEach(() => {
    bridge = new UdpBridge();
    events = [];
    (["rs485", "chart_update", "laser_data", "SJCJ_trigger"] as const).forEach((e) =>
      bridge.on(e, (data: unknown) => events.push({ event: e, data })),
    );
  });

  it("WAKE(cmd1=0x01,cmd2=0x00) → emit rs485 flag=0", () => {
    bridge._handleMessage(makePkt({ cmd1: 0x01, cmd2: 0x00 }), RINFO);
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number }).flag).toBe(0);
    expect((events[0].data as { name: string }).name).toBe("WAKE");
  });

  it("SELF_TEST(cmd1=0x02,cmd2=0x00) → emit rs485 flag=2", () => {
    bridge._handleMessage(makePkt({ cmd1: 0x02, cmd2: 0x00 }), RINFO);
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number }).flag).toBe(2);
  });

  it("BBH(cmd1=0x30,cmd2=0x00) → emit rs485 flag=5", () => {
    bridge._handleMessage(makePkt({ cmd1: 0x30, cmd2: 0x00 }), RINFO);
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number }).flag).toBe(5);
  });

  it("DATA_COLLECT(cmd1=0x00,cmd2=0x10) → 同时 emit rs485(flag=9) + chart_update + laser_data", () => {
    // DATA_COLLECT 特殊：msg[5]==0x00 时 emit rs485 + chart_update；始终 emit laser_data
    const pkt = makePkt({ cmd1: 0x00, cmd2: 0x10 });
    pkt[5] = 0x00; // 主数据分支条件
    bridge._handleMessage(pkt, RINFO);
    expect(events.some((e) => e.event === "rs485" && (e.data as { flag: number }).flag === 9)).toBe(true);
    expect(events.some((e) => e.event === "chart_update")).toBe(true);
    expect(events.some((e) => e.event === "laser_data")).toBe(true);
  });

  it("SJCJ_trigger(msg[12]=0x01,[13]=0x02,[14]=0x03) → emit SJCJ_trigger，不 emit rs485", () => {
    bridge._handleMessage(makePkt({ trigger: true }), RINFO);
    expect(events.some((e) => e.event === "SJCJ_trigger")).toBe(true);
    expect(events.some((e) => e.event === "rs485")).toBe(false);
  });

  it("短包（长度<16）不 emit", () => {
    bridge._handleMessage(Buffer.from([0x13, 0x02, 0x00]), RINFO);
    expect(events).toHaveLength(0);
  });

  it("非法头（非 0x13 0x02）不 emit", () => {
    const buf = Buffer.alloc(16);
    buf[0] = 0xff;
    buf[1] = 0xff;
    bridge._handleMessage(buf, RINFO);
    expect(events).toHaveLength(0);
  });

  it("未知 cmd（不在 CMD 表）不 emit rs485", () => {
    bridge._handleMessage(makePkt({ cmd1: 0xee, cmd2: 0xee }), RINFO);
    expect(events.some((e) => e.event === "rs485")).toBe(false);
  });
});
