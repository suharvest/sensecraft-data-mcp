# SenseCraft MCP Server

面向 SenseCAP / SenseCraft 生态的 [MCP](https://modelcontextprotocol.io) Server，对接 SenseCAP PaaS（sensecap.seeed.cc）设备/遥测数据接口，并提供 Arduino/PlatformIO 代码模板读取工具。

## 安装与构建

```bash
npm install
npm run build
```

构建产物在 `dist/`，会同时拷贝 `.env*` 配置与 `static/` 模板文件。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ACCESS_ID` / `ACCESS_KEY` | 是 | SenseCAP PaaS 开放平台的 API 凭据 |
| `SENSECRAFT_SITE_ENV` | 否 | `global`（默认，sensecap.seeed.cc）、`china`（国内站，sensecap.seeed.cn）或 `develop`（内部测试） |
| `SENSECRAFT_TIMEZONE` | 否 | 播报设备上报时间时使用的 IANA 时区（如 `Asia/Shanghai`）。`china` 站点默认已设为 `Asia/Shanghai`；其余站点不设置时会用 UTC 并明确标注，不会瞎猜时区 |
| `MCP_ENDPOINT` | 否 | 设置后以 WebSocket 客户端出站连接该地址（例如小智 ESP32 的 MCP 接入点），不设置则走 stdio |

## 用法一：stdio（Claude Desktop / Cursor 等）

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

## 用法二：接入小智 ESP32（XiaoZhi）的 MCP 接入点

在小智智控台拿到 `ws://<host>:8004/mcp_endpoint/mcp/?token=xxx` 这样的接入点地址后，直接启动：

```bash
MCP_ENDPOINT="ws://<host>:8004/mcp_endpoint/mcp/?token=xxx" \
ACCESS_ID=your-access-id \
ACCESS_KEY=your-access-key \
node dist/index.js
```

无需额外的 Python 桥接进程；断线会自动指数退避重连。详见仓库根目录 README 的[《接入小智 ESP32（XiaoZhi）》](../README.md#接入小智-esp32xiaozhi)一节。

## 工具（Tools）一览

| Tool | 说明 |
| --- | --- |
| `get_farm_overview` | 设备总览：几台设备、谁离线、谁电量低，异常优先播报 |
| `get_device_reading` | 按设备名称或 EUI 查询某一个设备当前全部通道的读数，格式化成一段可播报文字 |
| `register_device` | 注册设备并返回 EUI |
| `get_device_key` | 按设备名称或 EUI 查询 `device_key`/`token` |
| `view_latest_telemetry_data` | 查询最新遥测数据 |
| `list_telemetry_data` | 查询历史遥测数据 |
| `aggregate_chart_points` | 聚合遥测数据用于绘图 |
| `list_all_code` / `read_code_file` | 列出/读取 Arduino 代码模板 |

除 `register_device` 外，涉及设备的参数既可传设备名也可传 EUI，工具内部会做模糊匹配并在歧义时要求澄清。所有工具返回统一的 `{ success, facts: { executed }, say, say_kind, data }` 结构，便于语音助手直接口播 `say` 字段。

## 工业模式（Industrial mode，实验性）

工业模式使用本地 HTTP API 配置 MQTT Broker、MCP 接入点、设备字段与报警规则。Modbus RTU 到 MQTT 的协议转换由外部网关或 Multi-Gateway 完成；本服务只消费 MQTT 消息并提供 MCP 查询工具。

Industrial mode uses a local HTTP API to configure the MQTT broker, MCP endpoint, device fields, and alarm rules. Modbus RTU to MQTT conversion is provided by an external gateway or Multi-Gateway; this service consumes MQTT messages and exposes MCP query tools.

工业模式不需要 PaaS 的 `ACCESS_ID` / `ACCESS_KEY`。启动方式：

```bash
npm ci --registry=https://registry.npmmirror.com
npm run build
DATA_SOURCE=industrial INDUSTRIAL_HTTP_PORT=8080 \
INDUSTRIAL_CONFIG_PATH="$PWD/industrial-config.json" \
node dist/index.js
```

然后打开 <http://127.0.0.1:8080/>。页面按三步组织：先配置 MQTT 与设备字段，再配置报警条件和 `messageTemplate`，最后配置小智 HTTP 通知。Watcher 默认使用 80 端口，D1001 默认使用 8080 端口；`context` 模式只发送不超过 25 个 UTF-8 字节的短提示，`speak` 模式仅适用于兼容的本地 TTS server。MCP 接入点是可选的查询通道，必须粘贴 Web 控制台复制的完整地址（协议、路径和 token）。

Open <http://127.0.0.1:8080/>. The page follows three steps: MQTT and fields, alarm conditions and `messageTemplate`, then XiaoZhi HTTP notifications. Watcher defaults to port 80 and D1001 to 8080. `context` sends only a short cue of at most 25 UTF-8 bytes; `speak` is for a compatible self-hosted TTS server. The MCP endpoint is an optional query path and must be the complete address copied from the Web console, including protocol, path, and token.

工业报警通过 HTTP 与 MCP 查询分开。启用改版固件后，使用用户专属 MCP 工具 `self.remote_wake.configure({ token: "用户自选的随机 key", enabled: true })` 设置通知密钥，再在页面输入相同 token；密钥由用户自行生成，不要在聊天中发送。具体云端菜单位置尚未确认，不在文档中编造。真实 Watcher/D1001 联调尚未完成。

HTTP alarm delivery is separate from MCP queries. With firmware that provides the notification endpoint, call the user-only MCP tool `self.remote_wake.configure({ token: "a random key chosen by the user", enabled: true })` and enter the same token in the page. The user chooses the key; do not send it in chat. The exact cloud-console menu is not documented here because it has not been verified. Real Watcher/D1001 integration remains unverified.

Industrial mode does not need PaaS `ACCESS_ID` / `ACCESS_KEY` credentials:

```bash
npm ci --registry=https://registry.npmmirror.com
npm run build
DATA_SOURCE=industrial INDUSTRIAL_HTTP_PORT=8080 \
INDUSTRIAL_CONFIG_PATH="$PWD/industrial-config.json" \
node dist/index.js
```

Open <http://127.0.0.1:8080/>. Saving the UI configuration reconnects using the new MQTT configuration. The service delivers alarm notifications over HTTP through the configured Watcher or D1001 endpoint, and an optional MCP endpoint exposes read-only industrial query tools: `list_industrial_devices`, `get_industrial_reading`, and `list_industrial_alarms`. The existing PaaS / stdio flow remains unchanged.

具体行业的字段名、Topic、质量值和时间戳语义仍需用目标网关的真实 payload 核对；示例配置不代表具体硬件已验收。

接口包括：`GET/PUT /api/industrial/config`、`GET /api/industrial/status`、`GET /api/industrial/messages`、`POST /api/industrial/preview`、`POST /api/industrial/demo`、`GET/POST /api/industrial/notification/test` 和 `POST /api/industrial/notification/send-test`。notification test 只检查设备状态，不会唤醒；send-test 必须由用户明确点击，并提交当前页面 draft（`{ notification, text }`），返回 `status: "accepted"` 只表示服务接受请求，不代表设备已播报。配置写入 `INDUSTRIAL_CONFIG_PATH` 指定的文件；未设置时使用当前工作目录下的 `industrial-config.json`。容器运行时请把配置目录挂载到持久化卷。

The endpoints are `GET/PUT /api/industrial/config`, `GET /api/industrial/status`, `GET /api/industrial/messages`, `POST /api/industrial/preview`, `POST /api/industrial/demo`, `GET/POST /api/industrial/notification/test`, and `POST /api/industrial/notification/send-test`. The test endpoint probes status only; it never wakes the device. The explicit send-test submits the current page draft as `{ notification, text }` and returns `status: "accepted"` when the service accepts the request; this does not confirm playback. Configuration is written to the file selected by `INDUSTRIAL_CONFIG_PATH`, or `industrial-config.json` in the working directory when unset. Mount that directory as a persistent container volume.

`preview` 只返回映射结果，不改变在线状态或报警历史；`demo` 作为隔离试运行返回结果，显式标记 `simulated: true`，不会写入配置或向 MQTT 发布。模拟消息不能当作真实在线数据。工业网关点位消息可包含 `point_id`、`value`、`quality`、`source_timestamp`；坏质量消息可以被接收和检查，但在“近期有效数据”在线策略下不会使设备显示为正常在线。

`preview` returns mapping results without changing online state or alarm history; `demo` returns an isolated trial result, explicitly records `simulated: true`, does not write configuration, and never publishes to MQTT. Simulated messages must not be treated as live data. Industrial gateway point messages may contain `point_id`, `value`, `quality`, and `source_timestamp`; bad-quality messages may be received and inspected, but do not make a device healthy under the “recent valid data” policy.
