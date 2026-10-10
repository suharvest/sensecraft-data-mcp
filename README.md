# SenseCraft MCP

面向 SenseCAP / SenseCraft 生态的 [MCP](https://modelcontextprotocol.io)（Model Context Protocol）服务集合，让支持 MCP 的 AI 助手（如 Claude Desktop、Cursor 等）能够直接：

- 在 SenseCAP PaaS（sensecap.seeed.cc）开放平台上注册设备、查询密钥；
- 查询/聚合设备的遥测（传感器）数据；
- 读取并生成可直接用于 PlatformIO/Arduino 项目的采集与上报代码模板（WiFi 上报、温湿度采集、LED 控制等）；
- 通过 WebSocket 出站连接接入小智 ESP32（XiaoZhi）的 **MCP 接入点**，让小智语音助手也能调用以上工具（见[《接入小智 ESP32（XiaoZhi）》](#接入小智-esp32xiaozhi)）。

## 项目结构

```
sensecraft_mcp/
├── sensecraft_data_mcp/   # 核心 MCP Server（可发布使用）
│   ├── src/
│   │   ├── index.ts              # MCP Server 入口，按 MCP_ENDPOINT 是否设置二选一：
│   │   │                         # stdio transport（Claude Desktop/Cursor）或 WebSocket 出站接入点（小智）
│   │   ├── config/                # 环境变量与多环境配置
│   │   ├── transport/
│   │   │   └── ws_endpoint_transport.ts  # 出站连接小智 MCP 接入点的 Transport 实现
│   │   ├── mcp_tools/
│   │   │   ├── paas_client.ts     # 对接 SenseCAP PaaS openapi 的工具
│   │   │   ├── code_reader.ts     # Arduino/PlatformIO 代码模板读取工具
│   │   │   ├── response.ts        # 语音助手友好的响应包装（say/say_kind/facts.executed）
│   │   │   └── device_registry.ts # 设备名 <-> EUI 的本地别名缓存与模糊匹配
│   │   └── static/arduino/        # 代码模板（.h/.cpp）
│   └── package.json
└── coding-assistant/       # 实验性/占位项目，尚未实现具体功能
```

## MCP 工具（Tools）一览

### PaaS 数据接口（`paas_client.ts`）

| Tool | 说明 |
| --- | --- |
| `register_device` | 向 SenseCAP PaaS 平台注册设备，返回设备 EUI；注册成功后会自动记入本地设备别名缓存 |
| `get_device_key` | 根据设备名称或 EUI 查询 `device_key` 和 `token` |
| `view_latest_telemetry_data` | 查询设备（按 channel/measurement）最新一年内的遥测数据 |
| `list_telemetry_data` | 查询指定时间范围内的历史遥测数据（最长一个月，仅限最近三个月） |
| `aggregate_chart_points` | 按时间段聚合遥测数据用于绘制折线图（最多返回 250 个点） |

以上除 `register_device` 外，涉及设备的参数（`device_eui`/`nodeEui`）既可以传入真实的 16 位十六进制 EUI，也可以传入设备名称——工具会先尝试按 EUI 格式识别，否则在本地别名缓存中做模糊匹配；匹配到多个相近候选时会返回 `say_kind: "ask"` 并附上候选列表，从不擅自选择第一个结果。所有工具的返回值统一为 `{ success, facts: { executed }, say, say_kind, data }` 结构，`say` 是可以直接读给用户听的文本，`facts.executed` 仅在真正产生了写操作（如 `register_device` 成功）时为 `true`。

### 代码模板接口（`code_reader.ts`）

| Tool | 说明 |
| --- | --- |
| `list_all_code` | 列出所有可用的 Arduino 代码模板及其用途描述 |
| `read_code_file` | 根据 `uri` 读取指定模板的完整内容 |

内置模板包括：向 SenseCraft data 上报测量值/设备状态（RSSI 等）、DHT20 温湿度采集、LED 闪烁控制、`config.h` 全局配置、以及 `main.cpp` 项目入口示例。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ACCESS_ID` / `ACCESS_KEY` | 是 | SenseCAP PaaS 开放平台的 API 凭据，用于生成 `Authorization: Basic ...` 请求头 |
| `SENSECRAFT_SITE_ENV` | 否 | `global`（默认）或 `develop`，决定加载 `.env.global` / `.env.develop` 中的 `SENSECRAFT_DATA_SERVER_URL` 与 `LOGGER_LEVEL` |
| `MCP_ENDPOINT` | 否 | 设置后，服务不再监听 stdio，而是作为 WebSocket 客户端出站连接该地址（小智的 MCP 接入点地址），例如 `ws://<host>:8004/mcp_endpoint/mcp/?token=xxx` |

## 安装与构建

```bash
cd sensecraft_data_mcp
npm install
npm run build
```

构建产物在 `dist/`，会同时拷贝 `.env*` 配置与 `static/` 模板文件。

## 使用方式

`sensecraft_data_mcp` 通过 stdio 与 MCP 客户端通信，可在任意支持 MCP 的客户端中配置，例如 Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "sensecraft_data_mcp": {
      "command": "node",
      "args": ["/path/to/sensecraft_data_mcp/dist/index.js"],
      "env": {
        "ACCESS_ID": "your-access-id",
        "ACCESS_KEY": "your-access-key",
        "SENSECRAFT_SITE_ENV": "global"
      }
    }
  }
}
```

## 接入小智 ESP32（XiaoZhi）

小智（[xiaozhi-esp32](https://github.com/78/xiaozhi-esp32)）语音助手通过一个叫 **MCP 接入点**（[mcp-endpoint-server](https://github.com/xinnan-tech/mcp-endpoint-server)）的 WebSocket 网关来扩展工具：第三方 MCP server 主动出站连接到接入点地址，小智后端再把设备的语音意图转发过来调用这些工具。官方参考实现（[mcp-calculator](https://github.com/78/mcp-calculator)）用一个 Python 脚本 `mcp_pipe.py` 做 stdio↔WebSocket 的转发桥；本项目没有额外套一层桥接进程，而是直接给 `index.ts` 增加了第二种 transport（`src/transport/ws_endpoint_transport.ts`），用 Node 原生的 `WebSocket` 客户端实现 MCP SDK 的 `Transport` 接口，一个 Node 进程就能直连接入点，无需安装 Python。

### 部署步骤

1. 参照小智的[《MCP 接入点使用指南》](https://github.com/xinnan-tech/xiaozhi-esp32-server/blob/main/docs/mcp-endpoint-integration.md)启用 MCP 接入点功能，从智控台的智能体配置里拿到形如下面的地址：

   ```
   ws://<host>:8004/mcp_endpoint/mcp/?token=xxx
   ```

2. 构建本项目（见上文“安装与构建”），然后设置 `MCP_ENDPOINT` 环境变量启动：

   ```bash
   MCP_ENDPOINT="ws://<host>:8004/mcp_endpoint/mcp/?token=xxx" \
   ACCESS_ID=your-access-id \
   ACCESS_KEY=your-access-key \
   node sensecraft_data_mcp/dist/index.js
   ```

3. 连接成功后进入智控台刷新 MCP 接入状态，应能看到 `register_device`、`get_device_key`、`view_latest_telemetry_data` 等工具。断线会按指数退避（1s 起，最长 600s）自动重连，每次重连都会重建一个全新的 `McpServer` 实例，不会带着上一次的会话状态。

不设置 `MCP_ENDPOINT` 时行为不变，仍然是 stdio transport，可以继续在 Claude Desktop / Cursor 里使用。

### 面向语音场景的响应设计

由于语音交互不适合把原始 JSON 甩给用户，`paas_client.ts` 的工具返回值统一包装成：

```json
{
  "success": true,
  "facts": { "executed": false },
  "say": "已获取到设备\"客厅温湿度计\"的密钥信息。",
  "say_kind": "tell",
  "data": { "...": "..." }
}
```

- `say_kind`: `tell`（正常回答）/ `ask`（需要用户澄清，见 `data.candidates`）/ `fail`（失败，未执行任何操作）。
- `facts.executed`: 只有真正的写操作（目前是 `register_device` 成功时）才为 `true`，查询类工具恒为 `false`。
- 遥测类工具不会替用户编造单位或读数含义（PaaS 返回的字段语义未公开文档化），`say` 只做诚实的、基于数据量的摘要，具体数值始终在 `data` 里，超过 200 条会截断并在 `say` 中说明。
- 设备名解析：语音场景下用户会说设备名而不是 EUI，`device_registry.ts` 维护一个本地别名缓存（`~/.sensecraft_data_mcp/device_registry.json`），在 `register_device` 成功后自动记录，查询类工具收到非 EUI 格式的输入时会在缓存里做归一化 + 编辑距离的模糊匹配；命中多个相近候选且区分度不够时返回 `ask` 而不是自作主张选第一个。

## 技术栈

TypeScript · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) · axios · zod · dotenv

## 其他子项目

- `coding-assistant/`：早期实验性项目，目前仅有骨架代码，功能尚未实现。

## 工业模式（Industrial mode，实验性）

工业模式把网关发布的 MQTT 消息映射成 MCP 可查询的设备、字段和报警规则。Modbus RTU 等工业协议的转换由现场网关或 Multi-Gateway 完成；本项目只处理 MQTT 接入、JSON 字段映射和规则状态。

The industrial mode maps gateway-published MQTT messages into MCP-queryable devices, fields, and alarm rules. Modbus RTU conversion remains the responsibility of the gateway or Multi-Gateway; this project handles MQTT ingestion, JSON field mapping, and rule state.

### HTTP API

工业 HTTP API 返回统一结构：成功为 `{ "ok": true, "data": ... }`，失败为 `{ "ok": false, "error": { "code", "message" } }`。

The industrial HTTP API uses a common envelope: success is `{ "ok": true, "data": ... }`; failures are `{ "ok": false, "error": { "code", "message" } }`.

### 启动工业模式 / Start industrial mode

工业模式不需要 `ACCESS_ID`、`ACCESS_KEY` 或其他 PaaS 凭据。首次构建可使用国内 npm 镜像：

```bash
cd sensecraft_data_mcp
npm ci --registry=https://registry.npmmirror.com
npm run build
DATA_SOURCE=industrial \
INDUSTRIAL_HTTP_PORT=8080 \
INDUSTRIAL_CONFIG_PATH="$PWD/industrial-config.json" \
node dist/index.js
```

启动后打开 <http://127.0.0.1:8080/>。`INDUSTRIAL_HTTP_PORT` 未设置时默认使用 `8080`；`INDUSTRIAL_CONFIG_PATH` 未设置时使用当前工作目录的 `industrial-config.json`。保存配置后，MQTT 连接会按新配置重连，工业 MCP 工具读取同一份运行配置。原有 PaaS 模式不受影响，继续按上面的 PaaS 安装与 stdio 流程运行。

Industrial mode does not require `ACCESS_ID`, `ACCESS_KEY`, or other PaaS credentials. Build and start it with:

```bash
cd sensecraft_data_mcp
npm ci --registry=https://registry.npmmirror.com
npm run build
DATA_SOURCE=industrial \
INDUSTRIAL_HTTP_PORT=8080 \
INDUSTRIAL_CONFIG_PATH="$PWD/industrial-config.json" \
node dist/index.js
```

Open <http://127.0.0.1:8080/> after startup. `INDUSTRIAL_HTTP_PORT` defaults to `8080`; `INDUSTRIAL_CONFIG_PATH` defaults to `industrial-config.json` in the working directory. Saving the UI configuration reconnects MQTT with the new configuration, and the industrial MCP tools read that running configuration. The existing PaaS mode keeps its original installation and stdio flow.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/industrial/config` | Read persisted MQTT/MCP/device configuration. MQTT passwords are masked. |
| `PUT` | `/api/industrial/config` | Validate, persist, and reconnect with a full or partial configuration. |
| `GET` | `/api/industrial/status` | Read broker state, device state, current values, and alarms. |
| `GET` | `/api/industrial/messages` | Read the newest cached messages. |
| `POST` | `/api/industrial/preview` | Test a topic/payload mapping without changing online state or alarm history. |
| `POST` | `/api/industrial/demo` | Run an explicitly simulated message as an isolated trial; it is marked `simulated: true`, is not persisted as configuration, and never publishes to MQTT. |
| `GET`/`POST` | `/api/industrial/notification/test` | Probe the device status only; it does not wake the device. The response includes state/capabilities and enabled state. |
| `POST` | `/api/industrial/notification/send-test` | Explicit user-triggered test notification. `status: "accepted"` means accepted by the service, not confirmed playback. |

工业配置默认持久化到当前工作目录的 `industrial-config.json`，可通过 `INDUSTRIAL_CONFIG_PATH` 指向其他位置。容器部署时应将该文件所在目录挂载为持久化卷；不要把 Broker 密码提交进仓库或镜像。

By default, configuration is persisted to `industrial-config.json` in the process working directory. Set `INDUSTRIAL_CONFIG_PATH` to use another location. In a container, mount the directory containing this file as a persistent volume; do not commit or bake broker passwords into source or images.

### 消息配置与真实数据边界

配置界面支持设备 Topic、字段 Topic/JSON path、类型、单位、可查询性、质量路径、有效质量值、来源时间路径、在线策略和阈值报警。Multi-Gateway 的点位消息通常包含 `point_id`、`value`、`quality`、`source_timestamp`；同一设备可以为不同点位配置不同 Topic。

The configuration UI supports device topics, per-field topics and JSON paths, type, unit, queryability, quality path, accepted quality values, source timestamp path, online policy, and threshold alarms. Multi-Gateway point messages commonly contain `point_id`, `value`, `quality`, and `source_timestamp`; one device can map different point topics to separate fields.

The example in [`docs/industrial/example-config.json`](docs/industrial/example-config.json) uses placeholder broker values only. Final field names, topics, quality values, and timestamp semantics must be checked against a real gateway payload for the target industry before deployment.

“Preview mapping” is a dry run. “Send as simulation” calls `/api/industrial/demo` as an isolated trial, shows its result with a simulated label, and does not represent a live broker reading. A device must not be described as live merely because a message exists: the configured online policy and quality value determine whether the reading is valid. Messages with `quality: "bad"` can still be received and displayed while remaining invalid for a valid-data online policy.

### 三步使用流程 / Three-step flow

1. **数据与状态**：配置 MQTT Broker，添加设备和字段，使用 JSON path 选择点位，标记哪些字段可被 MCP 查询。Modbus RTU/TCP 到 MQTT 由现场网关或 Multi-Gateway 完成。
2. **报警条件**：选择设备、字段、运算符、阈值和持续时间，填写 `messageTemplate`（支持 `{device}`、`{field}`、`{value}`、`{unit}`、`{rule}`）。回差是可选的高级设置。
3. **小智连接**：HTTP 主动报警填写 Watcher（默认 80）或 D1001（默认 8080）的设备地址。`context` 只发送不超过 25 个 UTF-8 字节的短提示；`speak` 仅适用于兼容的本地 TTS server，发送完整模板文本。MCP 接入点是可选的查询通道，需粘贴 Web 控制台复制的完整地址（协议、路径和 token），不能只填写端口。

The industrial MCP surface exposes the read-only tools `list_industrial_devices`, `get_industrial_reading`, and `list_industrial_alarms`. The HTTP notification path is separate from MCP queries. The explicit send-test submits the current draft as `{ notification, text }`; `status: "accepted"` means accepted by the service, not confirmed playback. The device firmware must provide the `/api/wake` status and notification behavior; this repository has not been verified with real Watcher or D1001 hardware.

### 一次性配置设备通知密钥 / One-time device key setup

设备通知密钥由用户自己选择，不在聊天中发送。改版固件安装后，使用用户专属的 MCP 工具 `self.remote_wake.configure({ token: "用户自选的随机 key", enabled: true })` 写入设备配置，然后在本页面填写同一个 token。若该用户专属工具或改版固件尚未提供，通知连接只能停留在未验证状态；不要根据未知的云端菜单名称猜测配置入口。

The notification key is user-selected and must not be shared in chat. After installing firmware with the notification feature, call the user-only MCP tool `self.remote_wake.configure({ token: "a random key chosen by the user", enabled: true })`, then enter the same token in this UI. If that tool or firmware is unavailable, the notification path remains unverified.
