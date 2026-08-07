import { describe, it, expect } from "vitest";
import { validateConfig, loadConfig } from "../config";

// 所有 IP / 端口 / 串口号均为校验测试的占位值（RFC 1918 / example.test）：
// validateConfig 是纯函数不做任何 IO；loadConfig 测试只检查"文件不存在"分支。
// 全程不连接真实网络、串口或子进程（遵循 setup-ts-baseline 的测试隔离 spec）。

const validConfig = {
  http: { port: 8080 },
  ws: { port: 8081, portImg: 8082 },
  imageUpload: { remoteIp: "10.0.0.1", remotePort: 61440 },
  bridges: [
    { useTcp: true, localIp: "10.0.0.2", localPort: 30041, remoteIp: "10.0.0.3", remotePort: 30041 },
    { useTcp: true, localIp: "10.0.0.2", localPort: 30042, remoteIp: "10.0.0.3", remotePort: 61440 },
    { useTcp: true, localIp: "10.0.0.2", localPort: 30040, remoteIp: "10.0.0.3", remotePort: 61440 },
  ],
  turntable: { serialPort: "COM0", baudRate: 115200 },
  video: {
    rtspUrl: "rtsp://example.test/live",
    binarizedRtspUrl: "rtsp://example.test/live",
    ffmpegPath: "ffmpeg",
    srcWidth: 128,
    srcHeight: 128,
    bytesPerPixel16bit: 2,
  },
  dataDir: "data",
};

describe("validateConfig（纯函数，零 IO）", () => {
  it("合法配置返回空错误数组", () => {
    expect(validateConfig(validConfig)).toEqual([]);
  });

  it("缺少 http 时报错", () => {
    const { http: _omit, ...rest } = validConfig;
    void _omit;
    expect(validateConfig(rest).some((e) => e.includes("http"))).toBe(true);
  });

  it("bridges 长度不为 3 时报错", () => {
    const errors = validateConfig({ ...validConfig, bridges: [validConfig.bridges[0]] });
    expect(errors.some((e) => e.includes("bridges"))).toBe(true);
  });

  it("字段类型错误时报错", () => {
    const bad = { ...validConfig, http: { port: "不是数字" } };
    expect(validateConfig(bad).some((e) => e.includes("http.port"))).toBe(true);
  });

  it("配置根非对象时报错", () => {
    expect(validateConfig(null).length).toBeGreaterThan(0);
    expect(validateConfig([]).length).toBeGreaterThan(0);
  });
});

describe("loadConfig（IO 隔离）", () => {
  it("文件不存在时抛出明确错误，不触发任何网络/串口/子进程", () => {
    expect(() => loadConfig("./tests/fixtures/不应存在的配置-z03.json")).toThrow(/配置文件不存在/);
  });
});
