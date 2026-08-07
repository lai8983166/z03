import { describe, it, expect, vi } from "vitest";
import { WebSocket } from "ws";
import { broadcastTo, broadcastBinaryTo } from "../ws-bus";

// 只测纯函数（broadcastTo / broadcastBinaryTo），不调 createWsBus（避免绑真实端口）。
// mock WebSocket：只取 readyState + send 两个字段。
function makeMockClient(readyState: number): WebSocket {
  return { readyState, send: vi.fn() } as unknown as WebSocket;
}

describe("broadcastTo", () => {
  it("向 OPEN 客户端发送 JSON.stringify 后的字符串", () => {
    const client = makeMockClient(WebSocket.OPEN);
    broadcastTo(new Set([client]), { type: "test", value: 1 });
    expect((client as { send: { toHaveBeenCalledWith: (x: unknown) => void } }).send).toHaveBeenCalledWith(
      JSON.stringify({ type: "test", value: 1 }),
    );
  });

  it("跳过非 OPEN 客户端（CLOSED 不发送）", () => {
    const open = makeMockClient(WebSocket.OPEN);
    const closed = makeMockClient(WebSocket.CLOSED);
    broadcastTo(new Set([open, closed]), { type: "x" });
    expect((open as { send: { toHaveBeenCalledTimes: (n: number) => void } }).send).toHaveBeenCalledTimes(1);
    expect((closed as { send: { toHaveBeenCalled: () => void } }).send).not.toHaveBeenCalled();
  });

  it("空集合不报错", () => {
    expect(() => broadcastTo(new Set(), { type: "x" })).not.toThrow();
  });
});

describe("broadcastBinaryTo", () => {
  it("发送原始 Buffer，不经 JSON.stringify", () => {
    const client = makeMockClient(WebSocket.OPEN);
    const buf = Buffer.from([1, 2, 3]);
    broadcastBinaryTo(new Set([client]), buf);
    expect((client as { send: { toHaveBeenCalledWith: (x: unknown) => void } }).send).toHaveBeenCalledWith(buf);
  });

  it("跳过非 OPEN 客户端", () => {
    const closed = makeMockClient(WebSocket.CLOSED);
    broadcastBinaryTo(new Set([closed]), Buffer.from([1]));
    expect((closed as { send: { toHaveBeenCalled: () => void } }).send).not.toHaveBeenCalled();
  });

  it("空集合不报错", () => {
    expect(() => broadcastBinaryTo(new Set(), Buffer.from([1]))).not.toThrow();
  });
});
