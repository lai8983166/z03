import { describe, it, expect, beforeEach } from "vitest";
import TcpBridge from "../../TcpBridge";

// 构造符合协议的包头 Buffer。
// 注意 handleData 的路由读取：AR = msg[13]（line 278），cmd1 = msg[14]，cmd2 = msg[15]，
// payload = msg.subarray(16)。6000H 分支额外用 protocolAr=msg[12]、protocolAt=msg[13]。
function makePacket(
  opts: { ar?: number; cmd1?: number; cmd2?: number; payload?: number[]; head?: [number, number] } = {},
): Buffer {
  const { ar = 0x54, cmd1 = 0, cmd2 = 0, payload = [], head = [0x13, 0x02] as [number, number] } = opts;
  const buf = Buffer.alloc(16 + payload.length);
  buf[0] = head[0];
  buf[1] = head[1];
  buf[13] = ar; // AR = msg[13]（handleData 路由用）
  buf[14] = cmd1;
  buf[15] = cmd2;
  for (let i = 0; i < payload.length; i++) buf[16 + i] = payload[i];
  return buf;
}

describe("TcpBridge.handleData", () => {
  let bridge: any;
  let events: { event: string; data: unknown }[];

  beforeEach(() => {
    bridge = new TcpBridge();
    events = [];
    (["rs485", "YC", "heixiazi", "chart_update", "laser_data", "raw_text"] as const).forEach((e) =>
      bridge.on(e, (data: unknown) => events.push({ event: e, data })),
    );
  });

  it("AR=0x54 + cmd(0x20,0x00) → emit rs485 flag=27（FJYJZ_0020，命令表先于 BBH 匹配同 cmd 字节）", () => {
    // 注意：CMD_54 里 FJYJZ_0020 与 BBH 的 cmd1/cmd2 都是 0x20/0x00，
    // for 循环按定义顺序匹配，FJYJZ_0020(flag=27) 在前，BBH(flag=5) 被遮蔽。
    // 本测试如实记录该现状（不改代码，行为不变）。
    bridge.handleData(makePacket({ ar: 0x54, cmd1: 0x20, cmd2: 0x00 }));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number; name: string }).flag).toBe(27);
    expect((events[0].data as { name: string }).name).toBe("FJYJZ_0020");
  });

  it("AR=0x54 + CMD_3000H(cmd1=0x00,cmd2=0x30) → emit rs485 flag=6", () => {
    bridge.handleData(makePacket({ ar: 0x54, cmd1: 0x00, cmd2: 0x30 }));
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number }).flag).toBe(6);
  });

  it("AR=0x32 + SELF_TEST(cmd1=0x01,cmd2=0x00) → emit rs485 flag=30", () => {
    bridge.handleData(makePacket({ ar: 0x32, cmd1: 0x01, cmd2: 0x00 }));
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number }).flag).toBe(30);
  });

  it("AR=0x4A + SJL_SJCJ_B(cmd1=0x00,cmd2=0x10) → emit rs485 flag=40", () => {
    bridge.handleData(makePacket({ ar: 0x4a, cmd1: 0x00, cmd2: 0x10 }));
    expect(events[0].event).toBe("rs485");
    expect((events[0].data as { flag: number }).flag).toBe(40);
  });

  it("payload 透传到 data 字段", () => {
    bridge.handleData(makePacket({ ar: 0x54, cmd1: 0x20, cmd2: 0x00, payload: [0xaa, 0xbb] }));
    const data = (events[0].data as { data: Buffer }).data;
    expect(Array.from(data)).toEqual([0xaa, 0xbb]);
  });

  it("短包（长度<16）不 emit", () => {
    bridge.handleData(Buffer.from([0x13, 0x02, 0x00]));
    expect(events).toHaveLength(0);
  });

  it("非法头（非 0x13 0x02）不 emit", () => {
    const buf = Buffer.alloc(16);
    buf[0] = 0xff;
    buf[1] = 0xff;
    bridge.handleData(buf);
    expect(events).toHaveLength(0);
  });

  it("未知 AR（非 0x54/0x32/0x4A）不 emit rs485", () => {
    bridge.handleData(makePacket({ ar: 0x99 }));
    expect(events.filter((e) => e.event === "rs485")).toHaveLength(0);
  });

  it("localPort==30042 → emit YC（不进 AR 路由）", () => {
    bridge.localPort = 30042;
    bridge.handleData(makePacket({ ar: 0x54, cmd1: 0x20, cmd2: 0x00 }));
    expect(events.some((e) => e.event === "YC")).toBe(true);
    expect(events.some((e) => e.event === "rs485")).toBe(false);
  });

  it("6000H 代码上传分支：protocolAr=0xa0 protocolAt=0x52 co=0x6000 → emit rs485 flag=44", () => {
    // protocolAr=msg[12]=0xa0 (in CODE_UPLOAD_6000H_AR), protocolAt=msg[13]=0x52,
    // protocolCo=(msg[14]<<8)|msg[15] 大端 = 0x6000
    const buf = Buffer.alloc(20);
    buf[0] = 0x13;
    buf[1] = 0x02;
    buf[12] = 0xa0;
    buf[13] = 0x52;
    buf[14] = 0x60;
    buf[15] = 0x00;
    bridge.handleData(buf);
    const rs485 = events.filter((e) => e.event === "rs485");
    expect(rs485.length).toBeGreaterThanOrEqual(1);
    expect(rs485.some((e) => (e.data as { flag: number }).flag === 44)).toBe(true);
  });

  it("heixiazi：先 0x13 0x00 置 flag（不 emit），再 0x13 0x01 触发 emit heixiazi", () => {
    // 第一包：置 flag（msg[1]=0x00）
    const setBuf = Buffer.alloc(16);
    setBuf[0] = 0x13;
    setBuf[1] = 0x00;
    bridge.handleData(setBuf);
    expect(events).toHaveLength(0);

    // 第二包：触发（msg[1]=0x01，heixiazi_flag 已 true）
    const trigBuf = Buffer.alloc(16);
    trigBuf[0] = 0x13;
    trigBuf[1] = 0x01;
    bridge.handleData(trigBuf);
    expect(events.some((e) => e.event === "heixiazi")).toBe(true);
  });
});
