# Multi-Gateway compatibility / 多协议网关兼容性

## Evidence scope / 证据范围

The `multi_protocol_gateway` solution declares a Modbus TCP/RTU to MQTT gateway. Its deployment file pins `missionpack-knn:v1.6.7`. The source inspected here is the local build snapshot `/Users/harvest/tmp/missionpack-image-build-0291829`, which has no Git metadata or verified image digest provenance. Source findings below are not verification of the published image. No devices were accessed and no tests were executed during this review.

`multi_protocol_gateway` 方案声明支持 Modbus TCP/RTU 转 MQTT，部署文件固定使用 `missionpack-knn:v1.6.7`。本次检查的源码是本地构建快照 `/Users/harvest/tmp/missionpack-image-build-0291829`，没有 Git 元数据，也没有已核实的镜像 digest 来源。以下源码结论不代表发布镜像已验证。本次未访问设备、未运行测试。

The solution's GitHub link points to `Seeed-Solution/Solution_HVAC_SmartControl`; the inspected main tree contains the older HVAC/OPC UA application, without the gateway modules below. That tree does not establish the deployed gateway's source version.

方案 GitHub 链接指向 `Seeed-Solution/Solution_HVAC_SmartControl`；检查到的 main 文件树是旧版 HVAC/OPC UA 应用，没有下面的网关模块，因此不能据此确定部署镜像的源码版本。

## Compatibility / 兼容性

| Requirement / 要求 | Finding / 结论 | Evidence / 证据 |
|---|---|---|
| Modbus TCP reads / 读取 | Implemented in snapshot; published image needs verification / 快照已实现；发布镜像需验证 | `app_server/adapters/modbus_tcp.py:381`; `tests/component/test_modbus_tcp_socket.py:85,141` |
| Modbus RTU reads / 读取 | Snapshot production acquisition calls RTU transport; physical USB HIL remains pending / 快照采集调用 RTU transport；真实 USB 联调待完成 | `app_server/services/source_acquisition.py:508`; `docs/release-checklist.md:36` |
| Serial configuration / 串口配置 | Baud rate, 8 data bits, N/E/O parity, 1/2 stop bits, timeout / 波特率、8 数据位、N/E/O 校验、1/2 停止位、超时 | `app_server/adapters/modbus_rtu.py:84-115` |
| Polling / 轮询 | Configurable `collection_interval_seconds`, 1–3600 seconds / 可配置，范围 1–3600 秒 | `app_server/services/source_acquisition.py:34-42` |
| Point types / 点位类型 | Four Modbus tables; bool, int/uint16/32/64, float32/64; byte/word order / 四类表及对应数值类型、字节序和字序 | `app_server/adapters/modbus_contract.py:24-50` |
| Embedded MQTT / 内置 MQTT | Default host port 1883; broker must be configured and started / 默认主机端口 1883；需配置并启动 Broker | solution `assets/docker/docker-compose.yml:58-60`; snapshot `app_server/services/northbound_mqtt.py:605` |
| Authentication and TLS / 鉴权与 TLS | Configured password identities and TLS; anonymous access requires explicit configuration / 密码身份和 TLS；匿名需显式配置 | `app_server/adapters/mqtt_broker.py:146-172` |
| External broker publishing / 外部 Broker 上云 | Not included in the pinned deployment version / 固定部署版本不包含 | solution `assets/docker/docker-compose.yml:6-10` |
| Field-device failures / 下游失联 | Failed reads publish `value:null`, `quality:bad`; traffic continues / 失败读取仍发布消息，值为空、质量为 bad | `app_server/services/source_acquisition.py:491-498` |
| Telemetry retention / 遥测保留 | QoS 1, non-retained; new subscribers wait for another poll / QoS 1、不保留，新订阅需等下一轮 | `app_server/services/northbound_mqtt.py:288` |
| Gateway presence / 网关在线状态 | Retained birth and death topics; cannot alone prove field-device health / birth、death 为保留主题，不能单独证明下游设备健康 | `app_server/adapters/mqtt_broker.py:213-231` |

Source paths in the table refer to the unversioned snapshot unless prefixed with “solution”. Tests listed are available test cases, not test results from this review. The snapshot release checklist records RTU PTY coverage but leaves physical hardware, 24/72-hour soak and field upgrade gates incomplete (`docs/release-checklist.md:12-20,36`).

表内源码路径默认指未确认版本的快照；标有 “solution” 的路径指方案文件。所列测试是已有用例，不是本轮运行结果。快照发布检查单记录 RTU PTY 覆盖，但真实硬件、24/72 小时长稳和现场升级门禁未完成（`docs/release-checklist.md:12-20,36`）。

## Broker connection / Broker 连接

The MCP application can subscribe directly to the gateway's embedded broker at `mqtt://<gateway-host>:1883` when configured and reachable. The HTTP console defaults to port 8280. This path does not require the gateway to publish to an external broker.

MCP 应用可直接订阅已配置、可访问的网关内置 Broker：`mqtt://<网关主机>:1883`。HTTP 控制台默认端口为 8280。该路径不需要网关向外部 Broker 主动上云。

The pinned `v1.6.7` deployment excludes `/system/northbound-publish/*`. The solution comments identify the external publishing feature as `feature/northbound-publish` commit `f831bae`, with no built/published image tag assigned. An external/cloud broker therefore requires a separately verified bridge or a published gateway version containing that feature. This review does not establish an available bridge configuration.

固定部署版本 `v1.6.7` 不含 `/system/northbound-publish/*`。方案注释将外部发布功能标为 `feature/northbound-publish` 的 `f831bae`，尚未指定已构建发布的镜像 tag。因此外部/云端 Broker 路径需要另行验证的桥接，或发布包含该功能的网关版本。本次没有证据证明现成桥接配置可用。

For RTU, the default solution Compose does not mount a serial device. Map the intended stable host serial path into the container and verify permissions before physical testing; do not infer USB hardware support from PTY tests. See solution `description_zh.md:66`.

RTU 默认 Compose 不挂载串口。真实联调前需把选定的稳定主机串口路径映射到容器，并核实权限；不能从 PTY 测试推断实际 USB 硬件已支持。参见方案 `description_zh.md:66`。

## Actual point envelope / 实际点位消息

Snapshot `app_server/services/northbound_mqtt.py:270-288` emits this shape. Values below are an illustrative instance, not captured device data.

快照 `app_server/services/northbound_mqtt.py:270-288` 发布以下结构。下面是结构示例，不是设备采集记录。

```text
Topic: missionpack/v1/gw-01/points/meter-temperature
QoS: 1
Retain: false
```

```json
{
  "envelope": "missionpack.point-value.v1",
  "point_id": "meter-temperature",
  "value": 23.5,
  "quality": "good",
  "source_timestamp": "2026-10-10T04:00:00Z"
}
```

The topic carries the gateway and point identifiers; the payload does not include a source/device identifier. Map each point explicitly to its logical device. Multiple point topics from one physical device require multiple mappings. `source_timestamp` is the gateway acquisition time in this implementation (`source_acquisition.py:475`), not a timestamp read from the field controller.

主题含网关和点位标识，payload 不含数据源/物理设备标识。应显式将各点位映射到逻辑设备；一台物理设备有多个点位主题时需多条映射。这里 `source_timestamp` 是网关采集时间（`source_acquisition.py:475`），不是从控制器读取的时间戳。

```json
{
  "id": "meter-01",
  "name": "一号电表",
  "topic": "missionpack/v1/gw-01/points/#",
  "qualityPath": "quality",
  "goodQualityValues": ["good"],
  "timestampPath": "source_timestamp",
  "onlinePolicy": "valid_data",
  "onlineTimeoutSeconds": 30,
  "fields": [{
    "id": "temperature",
    "name": "温度",
    "topic": "missionpack/v1/gw-01/points/meter-temperature",
    "path": "value",
    "unit": "°C",
    "type": "number",
    "queryable": true
  }, {
    "id": "pressure",
    "name": "压力",
    "topic": "missionpack/v1/gw-01/points/meter-pressure",
    "path": "value",
    "unit": "bar",
    "type": "number",
    "queryable": true
  }],
  "rules": []
}
```

The MCP configuration supports the quality/time settings above and per-field topic/identity/quality/time overrides. See [example-config.json](example-config.json). Under `valid_data`, a new `quality:bad` message does not refresh last-good or establish field freshness; another fresh field may keep the device online. `message` instead measures message-link activity and can remain online on bad traffic while fields are stale. Numeric threshold evaluation excludes failed/stale samples. The envelope carries no detailed communication error code.

MCP 配置支持上述质量/时间设置及字段级主题/身份/质量/时间覆盖，完整配置见 [example-config.json](example-config.json)。使用 `valid_data` 时，新的 `quality:bad` 消息不刷新最后有效读数时间，也不建立字段新鲜度；另一字段仍新鲜时，设备可保持在线。`message` 判断消息链路活动，坏质量消息可维持在线，但字段仍过期。失败或过期数据不得用于数值阈值判定。点位消息不含详细通信错误码。

Gateway birth is retained JSON `{"gateway_id":"gw-01","status":"online"}` on `missionpack/v1/gw-01/birth`; death is retained text `offline` on `missionpack/v1/gw-01/death`. Because these are different topics, old retained messages can coexist. Do not treat a retained birth alone as current liveness. If the embedded broker itself fails, its clients lose connectivity; use MQTT connection state and freshness in addition to presence messages.

网关 birth 是保留 JSON `{"gateway_id":"gw-01","status":"online"}`，主题为 `missionpack/v1/gw-01/birth`；death 是保留文本 `offline`，主题为 `missionpack/v1/gw-01/death`。两个主题的旧保留消息可能并存，不能只凭 retained birth 判断当前在线。内置 Broker 自身故障会导致客户端失联，应结合 MQTT 连接状态和数据新鲜度。

## Integration acceptance / 实际联调验收

- Record deployed tag/digest and source provenance; confirm the actual image's broker and point schema. / 记录部署 tag/digest 及源码来源，确认实际镜像的 Broker 和点位结构。
- Read a known TCP register and a physical RTU register; compare values, units, address base, station ID and byte/word order with the controller register map. / 读取已知 TCP 寄存器及真实 RTU 寄存器，核对值、单位、地址基准、站号和字节/字序。
- Authenticate the MCP subscriber and validate TLS when configured; verify permissions restrict it to required telemetry. / 验证 MCP 订阅鉴权及配置的 TLS，核实只授予所需遥测权限。
- Subscribe before/after polling and confirm non-retained startup behavior, timestamp and quality handling. / 在轮询前后订阅，确认非 retained 的启动等待、时间戳和质量处理。
- Disconnect a field controller while leaving MQTT running: expect failed quality and no false online state or numeric alarm. / 保持 MQTT 运行并断开控制器：应出现坏质量，不得误报在线或数值告警。
- Stop/restart the gateway or broker: distinguish gateway connectivity from field-device status and confirm reconnection. / 停止并重启网关或 Broker，区分网关连接与下游状态，确认重连。
- Restart the MCP subscriber and verify explicit multi-point mappings reconstruct current readings after subsequent polls. / 重启 MCP 订阅端，确认显式多点映射在后续轮询后恢复当前读数。
- If external publishing is required, verify the deployed version supports it, then test outage/recovery and duplicate/stale handling separately. / 若需要外部上云，先确认部署版本支持，再独立验证断网恢复、重复和过期消息。

## Product usage / 产品使用流程

The industrial console is configured in three steps:

1. **Data and status** — configure the MQTT broker, add a logical device, and map gateway JSON fields. Mark only fields that XiaoZhi may query. The console does not implement Modbus conversion; use the gateway or Multi-Gateway.
2. **Alarm conditions** — choose a device field, operator, threshold and persistence duration. The optional `messageTemplate` supports `{device}`, `{field}`, `{value}`, `{unit}` and `{rule}`. Hysteresis is an advanced setting.
3. **XiaoZhi connection** — configure HTTP notification separately from MCP. Watcher uses port 80 by default and D1001 uses 8080. `context` sends a cue of at most 25 UTF-8 bytes; `speak` sends the full rendered message only to a compatible self-hosted TTS server. MCP is an optional read-only query path and requires the complete endpoint copied from the Web console, including protocol, path and token.

设备通知密钥由用户自选，不通过聊天传递。安装提供通知接口的改版固件后，使用用户专属 MCP 工具 `self.remote_wake.configure({ token: "用户自选的随机 key", enabled: 1 })` 写入设备，再把相同 token 填入控制台。这里不指定未经核实的云端菜单。Watcher/D1001 的真实硬件联调仍待完成。

The notification key is selected by the user and must not be sent in chat. After installing firmware with the notification endpoint, call the user-only MCP tool `self.remote_wake.configure({ token: "a random key chosen by the user", enabled: 1 })`, then enter the same token in the console. No unverified cloud-console menu is described here. Real Watcher/D1001 hardware integration remains pending.
