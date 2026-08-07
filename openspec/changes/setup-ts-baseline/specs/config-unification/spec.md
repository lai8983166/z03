# Spec Delta: config-unification

> 本 spec 描述本 change 新增的"配置统一"能力：所有运行时参数集中到 `config.json`，代码只读取不硬编码。特别注意：现有 `config.json` 已过时，本 change MUST 以 `server.js` 当前实际使用的值为唯一真相进行校准。

## ADDED Requirements

### Requirement: 单一配置来源
所有运行时参数——HTTP 端口、两个 WebSocket 端口（8081/8082）、三路 UDP/TCP 桥接的本地与远端 IP/端口、图像上传 IP/端口、串口名（`COM7`）与波特率（`115200`）、RTSP 地址、ffmpeg 路径、视频分辨率与帧字节大小、数据目录——MUST 集中在 `config.json` 一处；`server.js` MUST 通过读取该文件获得这些值，MUST NOT 再保留任何运行时硬编码字面量。

#### Scenario: server.js 读取 config.json 而非硬编码
- **WHEN** 在 `server.js` 中搜索 `192.168`、`COM7`、`115200`、`30041`、`8082` 等运行时值
- **THEN** 这些字面量不再以业务常量形式出现，全部改为从 `config.json` 读取的引用

#### Scenario: 修改配置无需改代码
- **WHEN** 仅修改 `config.json` 中某路桥接的远端 IP 后重启 server
- **THEN** server 使用新的 IP 进行连接，无需改动任何源码

### Requirement: 配置值校准到真实联调状态
现有 `config.json` 中 `192.168.10.x` 系列值已过时。本 change MUST 把 `config.json` 校准为 `server.js` 当前硬编码的真实值——三路桥接的本地 IP MUST 为 `192.168.0.20`、远端 IP MUST 为 `192.168.0.170`，本地端口 MUST 为 30041/30042/30040，远端端口 MUST 为 30041/61440，图像上传远端 MUST 为 `192.168.10.1:61440`，串口 MUST 为 `COM7`、波特率 MUST 为 115200，RTSP MUST 为 `rtsp://192.168.10.1:8554/live`。

#### Scenario: 校准后行为与重构前逐字一致
- **WHEN** 用校准后的 `config.json` 启动 server，与重构前启动方式对照
- **THEN** server 监听的端口、尝试连接的设备 IP/端口、串口、视频流地址均与重构前完全一致

### Requirement: 配置文件不入库但提供模板
`config.json` 包含环境相关的 IP/端口，已在 `.gitignore` 中忽略；本 change MUST 额外提供 `config.example.json`（结构 MUST 与 `config.json` 相同，可保留真实示例值或占位符）作为入库模板。

#### Scenario: 新机器按模板建立本地配置
- **WHEN** 在新开发机上克隆仓库后
- **THEN** 仓库内不存在 `config.json`（被忽略），但存在 `config.example.json`；复制该模板为 `config.json` 并填入本机值即可运行

### Requirement: 配置读取的健壮性
server 启动时 MUST 读取 `config.json`；若文件缺失或关键字段缺失，server MUST 给出清晰的错误信息并以非 0 退出码退出，MUST NOT 以 undefined 静默运行。

#### Scenario: config.json 缺失时明确报错
- **WHEN** `config.json` 不存在时启动 server
- **THEN** server 输出明确错误（指出缺少 config.json）并以非 0 退出码退出，不进入运行态
