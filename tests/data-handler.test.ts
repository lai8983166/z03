import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DataHandler 路由测试：vi.mock 所有 handler imports，构造 (flag, name, data)，
 * 验证对应 mock 被调用。
 */

// ---- mock 所有 handler imports ----
vi.mock("../js/Command", () => ({
  handle_CSZD_Recv_0100H: vi.fn(),
  handle_CSZD_Recv_0200H: vi.fn(),
  handle_GDCSZD_Recv_0300H: vi.fn(),
  handle_BBH_0030H: vi.fn(),
  handle_SelfTest_0002H: vi.fn(),
  handle_GDCSZDXC_Recv_0400H: vi.fn(),
  handle_GetSelfTestResult_0010H: vi.fn(),
  handle_Shut_0004H: vi.fn(),
  handle_Wake_0001H: vi.fn(),
  handle_FJYJZ_Recv_0020H: vi.fn(),
  handle_JGCSZD_Recv_0500H: vi.fn(),
  handle_JGCSZDXC_Recv_0600H: vi.fn(),
  handle_IRDetectParam_Recv_0700H: vi.fn(),
  handle_IRDetectParamRequest_Recv_0800H: vi.fn(),
  handle_SJCJ_Recv_010203H: vi.fn(),
  handle_SJCJ_Recv_1000H: vi.fn(),
  handle_SJCJ_Recv_F000H: vi.fn(),
  handle_CSZD_Recv_4000H: vi.fn(),
  handle_CSZD_Recv_3000H: vi.fn(),
  handle_FJYJZ_2000H: vi.fn(),
  handle_FJYJZJG_0020H: vi.fn(),
}));

vi.mock("../js/ImageUpload", () => ({
  handle_ImageUpload_0B00H: vi.fn(),
  handle_ImageUpload_Per_Frame_0B00H: vi.fn(),
}));

vi.mock("../js/CodeUpload", () => ({
  handle_CXSC_CodeUpload_HandShake_0615H_9000H: vi.fn(),
  handle_CXSC_CodeUpload_HandShake_0616H_9000H: vi.fn(),
  handle_CXSC_CodeDataUpload_Handshake_9000H: vi.fn(),
  handle_CXSC_CodeUpload_9000H: vi.fn(),
  handle_CXSC_CodeData_Check_9000H: vi.fn(),
  handle_CXSC_Code_Write_9000H: vi.fn(),
  handle_codeDownload_handshake_9000H: vi.fn(),
  handle_codeDownload_a000H: vi.fn(),
  handle_codedownload_crc: vi.fn(),
  handle_6000H_response: vi.fn(),
}));

vi.mock("../js/DataRouter", () => ({
  handle_SJL_SJCJ_Recv_0xFF: vi.fn(),
  handle_SJL_SJCJ_Recv_0x00: vi.fn(),
  handle_SJLTB_B: vi.fn(),
}));

vi.mock("../js/Telemeter", () => ({
  handle_YC_DATA_Per: vi.fn(),
}));

// 在所有 vi.mock 之后 import
import { handleRS485 } from "../js/DataHandler";
import * as Cmd from "../js/Command";
import * as Img from "../js/ImageUpload";
import * as Code from "../js/CodeUpload";
import * as Router from "../js/DataRouter";

function buf(firstByte: number, extra: number[] = []): Uint8Array {
  return new Uint8Array([firstByte, ...extra]);
}

describe("DataHandler.handleRS485 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flag=0 → handle_FJYJZ_2000H", () => {
    handleRS485(0, "FJYJZ_2000H", buf(0));
    expect(Cmd.handle_FJYJZ_2000H).toHaveBeenCalledTimes(1);
  });

  it("flag=1 → handle_Shut_0004H", () => {
    handleRS485(1, "Shut", buf(0));
    expect(Cmd.handle_Shut_0004H).toHaveBeenCalledTimes(1);
  });

  it("flag=2 → handle_SelfTest_0002H（无参函数，data 被忽略）", () => {
    handleRS485(2, "SelfTest", buf(0));
    expect(Cmd.handle_SelfTest_0002H).toHaveBeenCalledTimes(1);
  });

  it("flag=3 → handle_CSZD_Recv_0100H", () => {
    handleRS485(3, "CSZD_Recv_0100H", buf(0));
    expect(Cmd.handle_CSZD_Recv_0100H).toHaveBeenCalledTimes(1);
  });

  it("flag=5 → handle_BBH_0030H", () => {
    handleRS485(5, "BBH", buf(0));
    expect(Cmd.handle_BBH_0030H).toHaveBeenCalledTimes(1);
  });

  it("flag=9 → handle_SJCJ_Recv_1000H", () => {
    handleRS485(9, "SJCJ_Recv_1000H", buf(0));
    expect(Cmd.handle_SJCJ_Recv_1000H).toHaveBeenCalledTimes(1);
  });

  it("flag=10 → handle_GetSelfTestResult_0010H", () => {
    handleRS485(10, "GetSelfTestResult", buf(0));
    expect(Cmd.handle_GetSelfTestResult_0010H).toHaveBeenCalledTimes(1);
  });

  it("flag=15 → handle_JGCSZD_Recv_0500H", () => {
    handleRS485(15, "JGCSZD_Recv_0500H", buf(0));
    expect(Cmd.handle_JGCSZD_Recv_0500H).toHaveBeenCalledTimes(1);
  });

  it("flag=16 → handle_JGCSZDXC_Recv_0600H", () => {
    handleRS485(16, "JGCSZDXC_Recv_0600H", buf(0));
    expect(Cmd.handle_JGCSZDXC_Recv_0600H).toHaveBeenCalledTimes(1);
  });

  it("flag=17 → handle_IRDetectParam_Recv_0700H", () => {
    handleRS485(17, "IRDetectParam", buf(0));
    expect(Cmd.handle_IRDetectParam_Recv_0700H).toHaveBeenCalledTimes(1);
  });

  it("flag=19 data[0]=0x15 → handle_ImageUpload_0B00H", () => {
    handleRS485(19, "ImageUpload", buf(0x15));
    expect(Img.handle_ImageUpload_0B00H).toHaveBeenCalledTimes(1);
  });

  it("flag=19 data[0]=0x40 → handle_ImageUpload_Per_Frame_0B00H", () => {
    handleRS485(19, "ImageUpload", buf(0x40));
    expect(Img.handle_ImageUpload_Per_Frame_0B00H).toHaveBeenCalledTimes(1);
  });

  it("flag=20 → handle_SJCJ_Recv_010203H", () => {
    handleRS485(20, "SJCJ_Recv_010203H", buf(0));
    expect(Cmd.handle_SJCJ_Recv_010203H).toHaveBeenCalledTimes(1);
  });

  it("flag=21 → handle_SJCJ_Recv_F000H", () => {
    handleRS485(21, "SJCJ_Recv_F000H", buf(0));
    expect(Cmd.handle_SJCJ_Recv_F000H).toHaveBeenCalledTimes(1);
  });

  it("flag=22 → handle_CSZD_Recv_4000H", () => {
    handleRS485(22, "CSZD_Recv_4000H", buf(0));
    expect(Cmd.handle_CSZD_Recv_4000H).toHaveBeenCalledTimes(1);
  });

  it("flag=24 data[0]=0x15 短包（length<3）→ handle_CXSC_CodeUpload_HandShake_0615H_9000H", () => {
    handleRS485(24, "CodeUpload", buf(0x15, [0x00]));
    expect(Code.handle_CXSC_CodeUpload_HandShake_0615H_9000H).toHaveBeenCalledTimes(1);
  });

  it("flag=24 data[0]=0x15 长包 → handle_CXSC_CodeDataUpload_Handshake_9000H", () => {
    handleRS485(24, "CodeUpload", buf(0x15, [0x00, 0x00, 0x00]));
    expect(Code.handle_CXSC_CodeDataUpload_Handshake_9000H).toHaveBeenCalledTimes(1);
  });

  it("flag=24 data[0]=0x55 → handle_CXSC_CodeData_Check_9000H", () => {
    handleRS485(24, "CodeUpload", buf(0x55));
    expect(Code.handle_CXSC_CodeData_Check_9000H).toHaveBeenCalledTimes(1);
  });

  it("flag=24 data[0]=0x65 → handle_CXSC_Code_Write_9000H", () => {
    handleRS485(24, "CodeUpload", buf(0x65));
    expect(Code.handle_CXSC_Code_Write_9000H).toHaveBeenCalledTimes(1);
  });

  it("flag=25 data[0]=0x40 → handle_codeDownload_a000H", () => {
    handleRS485(25, "codeDownload", buf(0x40));
    expect(Code.handle_codeDownload_a000H).toHaveBeenCalledTimes(1);
  });

  it("flag=27 → handle_FJYJZJG_0020H", () => {
    handleRS485(27, "FJYJZJG", buf(0));
    expect(Cmd.handle_FJYJZJG_0020H).toHaveBeenCalledTimes(1);
  });

  it("flag=30 → handle_SelfTest_0002H（30/31/32 分支）", () => {
    handleRS485(30, "SelfTest", buf(0));
    expect(Cmd.handle_SelfTest_0002H).toHaveBeenCalledTimes(1);
  });

  it("flag=32 → handle_BBH_0030H", () => {
    handleRS485(32, "BBH", buf(0));
    expect(Cmd.handle_BBH_0030H).toHaveBeenCalledTimes(1);
  });

  it("flag=34 → handle_Wake_0001H", () => {
    handleRS485(34, "Wake", buf(0));
    expect(Cmd.handle_Wake_0001H).toHaveBeenCalledTimes(1);
  });

  it("flag=40 data[0]=0xFF → handle_SJL_SJCJ_Recv_0xFF", () => {
    handleRS485(40, "SJL", buf(0xff));
    expect(Router.handle_SJL_SJCJ_Recv_0xFF).toHaveBeenCalledTimes(1);
  });

  it("flag=40 data[0]=0x00 → handle_SJL_SJCJ_Recv_0x00", () => {
    handleRS485(40, "SJL", buf(0x00));
    expect(Router.handle_SJL_SJCJ_Recv_0x00).toHaveBeenCalledTimes(1);
  });

  it("flag=41 → handle_SJLTB_B", () => {
    handleRS485(41, "SJLTB", buf(0));
    expect(Router.handle_SJLTB_B).toHaveBeenCalledTimes(1);
  });

  it("flag=44 → handle_6000H_response(data, meta)", () => {
    const data = buf(0);
    handleRS485(44, "6000H", data, { ar: 0xa0, at: 0x52, co: 0x6000, command: null });
    expect(Code.handle_6000H_response).toHaveBeenCalledWith(data, {
      ar: 0xa0,
      at: 0x52,
      co: 0x6000,
      command: null,
    });
  });

  it("未知 flag → 不抛错（default 分支）", () => {
    expect(() => handleRS485(9999, "unknown", buf(0))).not.toThrow();
  });
});
