import { WebSocketServer, WebSocket } from "ws";

/**
 * ws-bus：WebSocket 传输基础设施。
 *
 * 提供 WS 服务器创建、clients/imgClients 集合管理与 broadcast 工具。
 * connection handler（业务消息分发）由 server.ts 在 wss/wssImg 上自行注册；
 * ws-bus 只负责传输层，不参与业务路由。
 */

/** 向指定客户端集合广播 JSON 消息（纯函数，便于单测，不绑端口） */
export function broadcastTo(clients: Set<WebSocket>, message: unknown): void {
  const msg = JSON.stringify(message);
  clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(msg);
    }
  });
}

/** 向指定客户端集合广播二进制 Buffer（跳过 JSON 序列化，纯函数） */
export function broadcastBinaryTo(clients: Set<WebSocket>, buffer: Buffer): void {
  clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(buffer);
    }
  });
}

/** ws-bus 对象接口 */
export interface WsBus {
  wss: WebSocketServer;
  wssImg: WebSocketServer;
  clients: Set<WebSocket>;
  imgClients: Set<WebSocket>;
  broadcast(message: unknown): void;
  broadcastImg(message: unknown): void;
  broadcastBinary(buffer: Buffer): void;
  close(): void;
}

/**
 * 创建 ws-bus：在 0.0.0.0 上启动两个 WebSocketServer（业务端口 + 图像端口），
 * 维护空 clients/imgClients 集合（由调用方的 connection handler 填充），
 * 返回 broadcast 等工具方法。
 */
export function createWsBus(port: number, portImg: number): WsBus {
  const wss = new WebSocketServer({ port, host: "0.0.0.0" });
  const wssImg = new WebSocketServer({ port: portImg, host: "0.0.0.0" });
  const clients = new Set<WebSocket>();
  const imgClients = new Set<WebSocket>();

  console.log(`🔌 WebSocket Server: ws://localhost:${port}`);
  console.log(`🔌 ImageUpload WebSocket Server: ws://localhost:${portImg}`);

  return {
    wss,
    wssImg,
    clients,
    imgClients,
    broadcast: (message) => broadcastTo(clients, message),
    broadcastImg: (message) => broadcastTo(imgClients, message),
    broadcastBinary: (buffer) => broadcastBinaryTo(clients, buffer),
    close: () => {
      wss.close();
      wssImg.close();
    },
  };
}
