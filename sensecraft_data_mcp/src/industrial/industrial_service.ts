import fs from 'node:fs';
import path from 'node:path';
import mqtt, { MqttClient } from 'mqtt';
import { z } from 'zod';
import { McpRegister, ToolItem } from '../mcp_tools/mcp_register';
export type FieldType = 'number' | 'string' | 'boolean';
export type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
export interface IndustrialField {
    id: string;
    name: string;
    path: string;
    unit?: string;
    topic?: string;
    idPath?: string;
    idValue?: string | number;
    qualityPath?: string;
    goodQualityValues?: string[];
    timestampPath?: string;
    type: FieldType;
    queryable: boolean;
}
export interface IndustrialRule {
    id: string;
    name: string;
    fieldId: string;
    operator: Operator;
    threshold: number | string | boolean;
    durationSeconds: number;
    hysteresis: number;
    enabled: boolean;
    messageTemplate?: string;
}
export interface IndustrialDevice {
    id: string;
    name: string;
    topic: string;
    idPath?: string;
    idValue?: string | number;
    qualityPath?: string;
    goodQualityValues?: string[];
    timestampPath?: string;
    onlinePolicy?: 'message' | 'valid_data';
    onlineTimeoutSeconds: number;
    fields: IndustrialField[];
    rules: IndustrialRule[];
}
export interface IndustrialConfig {
    mqtt: {
        url: string;
        username?: string;
        password?: string;
        clientId?: string;
        tlsRejectUnauthorized?: boolean;
    };
    mcp: {
        endpoint?: string;
    };
    notification?: {
        enabled: boolean;
        deviceType: 'watcher' | 'd1001';
        baseUrl: string;
        token?: string;
        mode: 'context' | 'speak';
        context: string;
        timeoutMs: number;
    };
    devices: IndustrialDevice[];
}
export interface IndustrialMessage {
    topic: string;
    payload: unknown;
    receivedAt: string;
    sourceTimestamp?: string;
    retained: boolean;
    simulated: boolean;
    deviceId?: string;
}
interface DeviceRuntime {
    last?: IndustrialMessage;
    lastLive?: IndustrialMessage;
    lastMessageAt?: string;
    lastGoodAt?: string;
    values: Record<string, unknown>;
    fieldMeta: Record<string, any>;
    alarms: Alarm[];
    pending: Record<string, number>;
    ruleActive: Record<string, boolean>;
}
export interface Alarm {
    id: string;
    ruleId: string;
    name: string;
    deviceId: string;
    fieldId: string;
    value: unknown;
    threshold: unknown;
    active: boolean;
    startedAt: string;
    recoveredAt?: string;
    simulated?: boolean;
    message?: string;
}
export interface NotificationDelivery {
    id: string;
    alarmId: string;
    ruleId: string;
    deviceId: string;
    status: 'accepted' | 'failed';
    requestedAt: string;
    responseStatus?: number;
    error?: string;
    textBytes?: number;
    test?: boolean;
}
const defaultConfig: IndustrialConfig = { mqtt: { url: '', tlsRejectUnauthorized: true }, mcp: {}, devices: [] };
const configSchema = z.object({ mqtt: z.object({ url: z.string(), username: z.string().optional(), password: z.string().optional(), clientId: z.string().optional(), tlsRejectUnauthorized: z.boolean().optional() }), mcp: z.object({ endpoint: z.string().optional() }), notification: z.object({ enabled: z.boolean(), deviceType: z.enum(['watcher', 'd1001']), baseUrl: z.string().url(), token: z.string().optional(), mode: z.enum(['context', 'speak']), context: z.string(), timeoutMs: z.number().int().positive().max(60000) }).optional(), devices: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), topic: z.string().min(1), idPath: z.string().optional(), idValue: z.union([z.string(), z.number()]).optional(), qualityPath: z.string().optional(), goodQualityValues: z.array(z.string()).optional(), timestampPath: z.string().optional(), onlinePolicy: z.enum(['message', 'valid_data']).optional(), onlineTimeoutSeconds: z.number().positive(), fields: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), path: z.string().min(1), topic: z.string().optional(), idPath: z.string().optional(), idValue: z.union([z.string(), z.number()]).optional(), qualityPath: z.string().optional(), goodQualityValues: z.array(z.string()).optional(), timestampPath: z.string().optional(), unit: z.string().optional(), type: z.enum(['number', 'string', 'boolean']), queryable: z.boolean() })), rules: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), fieldId: z.string(), operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']), threshold: z.union([z.number(), z.string(), z.boolean()]), durationSeconds: z.number().nonnegative(), hysteresis: z.number().nonnegative(), enabled: z.boolean(), messageTemplate: z.string().max(500).optional() })) })) });
export function getByPath(value: unknown, expression: string): unknown {
    let current: any = value;
    for (const part of expression.split('.')) {
        if (!part)
            continue;
        const match = part.match(/^([^\[\]]+)(?:\[(\d+)\])?$/);
        if (!match || current == null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, match[1]))
            return undefined;
        current = current[match[1]];
        if (match[2] !== undefined)
            current = Array.isArray(current) ? current[Number(match[2])] : undefined;
    }
    return current;
}
function topicMatches(filter: string, topic: string): boolean { const a = filter.split('/'), b = topic.split('/'); for (let i = 0; i < a.length; i++) {
    if (a[i] === '#')
        return true;
    if (a[i] === '+') {
        if (b[i] === undefined)
            return false;
        continue;
    }
    if (a[i] !== b[i])
        return false;
} return a.length === b.length; }
function compare(value: unknown, op: Operator, threshold: unknown): boolean { if (op === 'eq')
    return value === threshold; if (op === 'neq')
    return value !== threshold; if (typeof value === 'number' && typeof threshold === 'number') {
    if (op === 'gt')
        return value > threshold;
    if (op === 'gte')
        return value >= threshold;
    if (op === 'lt')
        return value < threshold;
    return value <= threshold;
} return false; }
function validateConfig(input: unknown): IndustrialConfig {
    const normalized: any = structuredClone(input);
    if (normalized?.notification) {
        normalized.notification.context ??= '工业报警';
        normalized.notification.timeoutMs ??= 3000;
    }
    const config = configSchema.parse(normalized) as IndustrialConfig;
    config.mqtt.tlsRejectUnauthorized ??= true;
    if (config.mqtt.url && !/^mqtts?:\/\//i.test(config.mqtt.url)) throw new Error('Use mqtt:// or mqtts://');
    if (config.mcp.endpoint && !/^wss?:\/\//i.test(config.mcp.endpoint)) throw new Error('Use ws:// or wss://');
    if (config.mqtt.url) {
        const broker = new URL(config.mqtt.url);
        if (!broker.hostname) throw new Error('MQTT broker needs a hostname');
        if (broker.username || broker.password) throw new Error('Enter MQTT credentials in the username/password fields');
    }
    if (config.mcp.endpoint && !new URL(config.mcp.endpoint).hostname) throw new Error('MCP endpoint needs a hostname');
    if (config.notification) {
        if (Buffer.byteLength(config.notification.context, 'utf8') > 25) throw new Error('notification.context must be at most 25 UTF-8 bytes');
    }
    const ids = new Set<string>();
    for (const d of config.devices) {
        if (ids.has(d.id)) throw new Error(`duplicate device id: ${d.id}`);
        ids.add(d.id);
        const topics = [d.topic, ...d.fields.map(f => f.topic).filter(Boolean)];
        for (const topic of topics) {
            if (!topic.trim() || topic.includes('\0') || topic.split('/').some((part, i, parts) =>
                part.includes('#') && (part !== '#' || i !== parts.length - 1) || part.includes('+') && part !== '+')) {
                throw new Error('Invalid MQTT topic filter');
            }
        }
        const fields = new Map<string, IndustrialField>();
        for (const f of d.fields) {
            if (fields.has(f.id)) throw new Error(`duplicate field id: ${f.id}`);
            fields.set(f.id, f);
            if ((f.qualityPath || d.qualityPath) && !(f.goodQualityValues || d.goodQualityValues)?.length) {
                throw new Error(`field ${f.id} needs accepted quality values`);
            }
        }
        const rules = new Set<string>();
        for (const r of d.rules) {
            if (rules.has(r.id)) throw new Error(`duplicate rule id: ${r.id}`);
            rules.add(r.id);
            const f = fields.get(r.fieldId);
            if (!f) throw new Error(`rule ${r.id} references unknown field ${r.fieldId}`);
            if (typeof r.threshold !== f.type || (!['eq', 'neq'].includes(r.operator) && f.type !== 'number')) {
                throw new Error(`rule ${r.id} threshold/operator does not match field type`);
            }
        }
    }
    return config;
}
function maskEndpoint(endpoint: string): string {
    const url = new URL(endpoint);
    if (url.username) url.username = '********';
    if (url.password) url.password = '********';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '********');
    return url.toString();
}
export class IndustrialService implements McpRegister {
    onConfigUpdated?: (config: IndustrialConfig) => void;
    config: IndustrialConfig;
    readonly configPath: string;
    client?: MqttClient;
    broker = { state: 'disconnected' as string, connected: false, lastError: undefined as string | undefined };
    messages: IndustrialMessage[] = [];
    deliveries: NotificationDelivery[] = [];
    private alarmSequence = 0;
    runtimes = new Map<string, DeviceRuntime>();
    constructor(configPath = process.env.INDUSTRIAL_CONFIG_PATH || path.join(process.cwd(), 'industrial-config.json')) { this.configPath = configPath; this.config = this.load(); this.resetRuntimes(); }
    private load(): IndustrialConfig {
        if (!fs.existsSync(this.configPath)) return structuredClone(defaultConfig);
        return validateConfig(JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
    }
    private resetRuntimes() { this.runtimes.clear(); for (const d of this.config.devices)
        this.runtimes.set(d.id, { values: {}, fieldMeta: {}, alarms: [], pending: {}, ruleActive: {} }); }
    maskedConfig(): any {
        const c: any = structuredClone(this.config);
        c.mqtt.password = c.mqtt.password ? '********' : '';
        c.mqtt.passwordConfigured = !!this.config.mqtt.password;
        c.mcp.endpoint = c.mcp.endpoint ? maskEndpoint(c.mcp.endpoint) : '';
        c.mcp.endpointConfigured = !!this.config.mcp.endpoint;
        if (c.notification?.token) c.notification.token = '********';
        if (c.notification) c.notification.tokenConfigured = !!this.config.notification?.token;
        return c;
    }
    update(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object');
        const current = this.config, body = input as any;
        const merged = {...current, ...body, mqtt: {...current.mqtt, ...body.mqtt}, mcp: {...current.mcp, ...body.mcp}, notification: body.notification === undefined ? current.notification : {...current.notification, ...body.notification}};
        if (body.mqtt?.password === '********') merged.mqtt.password = current.mqtt.password;
        if (current.mcp.endpoint && body.mcp?.endpoint === maskEndpoint(current.mcp.endpoint)) merged.mcp.endpoint = current.mcp.endpoint;
        if (current.notification?.token && body.notification?.token === '********') merged.notification.token = current.notification.token;
        if (body.notification?.token === '') merged.notification.token = '';
        if (merged.mcp.endpoint?.includes('********')) throw new Error('Enter the complete new MCP endpoint');
        const checked = validateConfig(merged);
        fs.mkdirSync(path.dirname(this.configPath), {recursive: true});
        const temp = `${this.configPath}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(checked, null, 2), {mode: 0o600});
        fs.renameSync(temp, this.configPath);
        this.config = checked;
        this.resetRuntimes();
        void this.connect();
        this.onConfigUpdated?.(checked);
        return checked;
    }
    async connect() { if (this.client) {
        const old = this.client;
        this.client = undefined;
        old.end(true);
    } if (!this.config.mqtt.url) {
        this.broker = { state: 'disconnected', connected: false, lastError: undefined };
        return;
    } this.broker = { state: 'connecting', connected: false, lastError: undefined }; try {
        const c = this.client = mqtt.connect(this.config.mqtt.url, { username: this.config.mqtt.username, password: this.config.mqtt.password, clientId: this.config.mqtt.clientId || undefined, rejectUnauthorized: this.config.mqtt.tlsRejectUnauthorized });
        c.on('connect', () => { if (this.client !== c) return; this.broker = { state: 'connected', connected: true, lastError: undefined }; const topics = [...new Set(this.config.devices.flatMap(d => [d.topic, ...d.fields.map(f => f.topic).filter(Boolean) as string[]]))]; for (const t of topics)
            c.subscribe(t); });
        c.on('message', (topic, payload, packet) => { if (this.client === c) this.ingest(topic, parsePayload(payload.toString()), !!packet.retain, false); });
        c.on('error', () => { if (this.client !== c) return; this.broker = { state: 'error', connected: false, lastError: 'MQTT connection failed' }; this.clearPending(); });
        c.on('close', () => { if (this.client !== c) return; this.clearPending(); if (this.broker.state !== 'error')
            this.broker = { state: 'disconnected', connected: false, lastError: undefined }; });
    }
    catch (e) {
        this.broker = { state: 'error', connected: false, lastError: 'MQTT connection failed' };
    } }
    private clearPending() { for (const rt of this.runtimes.values()) rt.pending = {}; }
    private matchesMapping(d: IndustrialDevice, f: IndustrialField, topic: string, payload: unknown) {
        return topicMatches(f.topic || d.topic, topic) && this.matchesIdentity(d, payload) && this.matchesField(f, topic, payload);
    }
    private fresh(d: IndustrialDevice, meta: any, now = Date.now()) {
        const cutoff = now - d.onlineTimeoutSeconds * 1000;
        return !!meta?.valid && !meta.retained && (!this.config.mqtt.url || this.broker.connected) &&
            Date.parse(meta.receivedAt) >= cutoff && (!meta.sourceTimestamp || Date.parse(meta.sourceTimestamp) >= cutoff);
    }
    ingest(topic: string, payload: unknown, retained = false, simulated = false, receivedAt = new Date().toISOString()) {
        if (simulated) return this.demo({topic, payload, retained});
        const matched = this.config.devices.filter(d => d.fields.some(f => this.matchesMapping(d, f, topic, payload)));
        this.messages.unshift({ topic, payload, receivedAt, retained, simulated });
        const cache = Number(process.env.INDUSTRIAL_MESSAGE_CACHE_SIZE || 200);
        this.messages = this.messages.slice(0, Number.isFinite(cache) ? Math.max(1, Math.min(cache, 1000)) : 200);
        for (const d of matched) {
        const rt = this.runtimes.get(d.id)!;
        const updated = new Set<string>();
        for (const f of d.fields) {
            if (!this.matchesMapping(d, f, topic, payload))
                continue;
            const previous = rt.fieldMeta[f.id];
            if (!this.fresh(d, previous, Date.parse(receivedAt))) {
                for (const r of d.rules) if (r.fieldId === f.id) delete rt.pending[r.id];
            }
            const sourceRaw = f.timestampPath ? getByPath(payload, f.timestampPath) : d.timestampPath ? getByPath(payload, d.timestampPath) : undefined;
            const sourceTimestamp = sourceRaw === undefined ? undefined : parseSourceTimestamp(sourceRaw);
            const qualityPath = f.qualityPath || d.qualityPath;
            const goodValues = f.goodQualityValues || d.goodQualityValues;
            const quality = qualityPath ? getByPath(payload, qualityPath) : undefined;
            const qualityGood = !qualityPath || !!goodValues?.includes(String(quality));
            const hasTimestamp = !!(f.timestampPath || d.timestampPath);
            const sourceFresh = !hasTimestamp || !!sourceTimestamp &&
                Date.parse(sourceTimestamp) >= Date.parse(receivedAt) - d.onlineTimeoutSeconds * 1000 &&
                Date.parse(sourceTimestamp) <= Date.parse(receivedAt) + 5000;
            const value = this.cast(getByPath(payload, f.path), f.type);
            const ordered = !sourceTimestamp || !previous?.valueSourceTimestamp || Date.parse(sourceTimestamp) > Date.parse(previous.valueSourceTimestamp);
            const valid = !retained && qualityGood && sourceFresh && ordered && value !== undefined;
            const meta = rt.fieldMeta[f.id] = { receivedAt, sourceTimestamp, quality, valid, fresh: valid, stale: !valid, retained,
                valueReceivedAt: previous?.valueReceivedAt, valueSourceTimestamp: previous?.valueSourceTimestamp };
            const msg = { topic, payload, sourceTimestamp, receivedAt, retained, simulated, deviceId: d.id };
            rt.last = msg;
            if (!retained) rt.lastMessageAt = receivedAt;
            if (valid) {
                    rt.values[f.id] = value;
                    meta.valueReceivedAt = receivedAt;
                    meta.valueSourceTimestamp = sourceTimestamp;
                    updated.add(f.id);
                    rt.lastLive = msg;
                    rt.lastGoodAt = receivedAt;
            }
            else
                for (const r of d.rules)
                    if (r.fieldId === f.id)
                        delete rt.pending[r.id];
        }
        if (updated.size)
            this.applyRules(d, rt, receivedAt, simulated, updated);
    } return this.evaluate(topic, payload, retained, simulated); }
    private cast(v: unknown, t: FieldType) {
        if (v === null || v === undefined) return undefined;
        if (t === 'number') {
        if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return undefined;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : undefined;
    } if (t === 'boolean') {
        if (v === true || v === 'true' || v === 1 || v === '1') return true;
        if (v === false || v === 'false' || v === 0 || v === '0') return false;
        return undefined;
    } return ['string', 'number', 'boolean'].includes(typeof v) ? String(v) : undefined; }
    private matchesIdentity(d: IndustrialDevice, payload: unknown) { if (!d.idPath)
        return true; return getByPath(payload, d.idPath) === d.idValue; }
    private matchesField(f: IndustrialField, topic: string, payload: unknown) { if (f.topic && !topicMatches(f.topic, topic))
        return false; if (!f.idPath)
        return true; return getByPath(payload, f.idPath) === f.idValue; }
    evaluate(topic: string, payload: unknown, retained = false, simulated = false) { const device = this.config.devices.find(d => d.fields.some(f => this.matchesMapping(d, f, topic, payload))); if (!device)
        return { matched: false, values: {}, alarms: [], ignoredFields: [] }; const values: any = {}; const ignored: string[] = []; const validity: Record<string, boolean> = {}; for (const f of device.fields) {
        if (!this.matchesMapping(device, f, topic, payload))
            continue;
        const v = getByPath(payload, f.path);
        const cast = this.cast(v, f.type);
        const qp = f.qualityPath || device.qualityPath, tp = f.timestampPath || device.timestampPath;
        const source = tp ? parseSourceTimestamp(getByPath(payload, tp)) : undefined;
        const accepted = !retained && cast !== undefined &&
            (!qp || !!(f.goodQualityValues || device.goodQualityValues)?.includes(String(getByPath(payload, qp)))) &&
            (!tp || !!source && Date.parse(source) >= Date.now() - device.onlineTimeoutSeconds * 1000 && Date.parse(source) <= Date.now() + 5000);
        validity[f.id] = accepted;
        if (v !== undefined && cast !== undefined && f.queryable)
            values[f.id] = cast;
        else if (v !== undefined && !f.queryable)
            ignored.push(f.id);
    } return { deviceId: device.id, matched: true, values, validity, alarms: retained ? [] : this.previewAlarms(device, values, simulated, validity), ignoredFields: ignored }; }
    private previewAlarms(d: IndustrialDevice, values: Record<string, unknown>, simulated = false, validity: Record<string, boolean> = {}) {
        return d.rules.filter(r => r.enabled && validity[r.fieldId] && values[r.fieldId] !== undefined && compare(values[r.fieldId], r.operator, r.threshold))
            .map(r => ({ ruleId: r.id, name: r.name, deviceId: d.id, fieldId: r.fieldId, value: values[r.fieldId],
                threshold: r.threshold, durationSeconds: r.durationSeconds, pending: r.durationSeconds > 0, simulated }));
    }
    private applyRules(d: IndustrialDevice, rt: DeviceRuntime, now: string, simulated: boolean, updated?: Set<string>) { for (const r of d.rules) {
        if (!r.enabled || updated && !updated.has(r.fieldId))
            continue;
        const value = rt.values[r.fieldId];
        const active = rt.ruleActive[r.id] || false;
        const tripped = compare(value, r.operator, r.threshold);
        if (tripped && !active) {
            if (rt.pending[r.id] === undefined)
                rt.pending[r.id] = Date.parse(now);
            if (Date.parse(now) - rt.pending[r.id] >= r.durationSeconds * 1000) {
                rt.ruleActive[r.id] = true;
                delete rt.pending[r.id];
                rt.alarms.unshift({ id: `${d.id}:${r.id}:${Date.now()}:${++this.alarmSequence}`, ruleId: r.id, name: r.name, deviceId: d.id, fieldId: r.fieldId, value, threshold: r.threshold, active: true, startedAt: now, simulated });
                const alarm = rt.alarms[0];
                alarm.message = this.renderMessage(d, r, value);
                if (!simulated) void this.deliverAlarm(alarm, d, r);
                rt.alarms = [...rt.alarms.filter(a => a.active), ...rt.alarms.filter(a => !a.active).slice(0, 200)];
            }
        }
        else if (!tripped) {
            delete rt.pending[r.id];
            if (active && this.recovered(value, r)) {
                rt.ruleActive[r.id] = false;
                const alarm = rt.alarms.find(a => a.ruleId === r.id && a.active);
                if (alarm) {
                    alarm.active = false;
                    alarm.recoveredAt = now;
                }
            }
        }
    } }
    private recovered(value: unknown, r: IndustrialRule) { if (typeof value !== 'number' || typeof r.threshold !== 'number' || !r.hysteresis)
        return true; return r.operator === 'gt' || r.operator === 'gte' ? value <= r.threshold - r.hysteresis : r.operator === 'lt' || r.operator === 'lte' ? value >= r.threshold + r.hysteresis : true; }
    status() {
        const now = Date.now();
        return {broker: this.broker, notification: {configured: !!this.config.notification?.baseUrl, enabled: !!this.config.notification?.enabled, deviceType: this.config.notification?.deviceType, mode: this.config.notification?.mode, deliveries: this.deliveriesList()}, devices: this.config.devices.map(d => {
            const rt = this.runtimes.get(d.id)!;
            const fieldStatus: Record<string, any> = {};
            for (const f of d.fields) {
                const meta = rt.fieldMeta[f.id];
                const fresh = this.fresh(d, meta, now);
                fieldStatus[f.id] = {...meta, fresh, stale: !fresh};
                if (!fresh) for (const rule of d.rules) if (rule.fieldId === f.id) delete rt.pending[rule.id];
            }
            const age = rt.lastMessageAt ? Math.max(0, (now - Date.parse(rt.lastMessageAt)) / 1000) : undefined;
            const anyFresh = Object.values(fieldStatus).some(f => f.fresh);
            const live = d.onlinePolicy === 'message' ? age !== undefined && age <= d.onlineTimeoutSeconds : anyFresh;
            const brokerOk = !this.config.mqtt.url || this.broker.connected;
            const state = !rt.lastMessageAt ? 'unknown' : live && brokerOk ? 'online' : 'offline';
            return {id: d.id, name: d.name, state, lastMessageAt: rt.last?.receivedAt, lastGoodAt: rt.lastGoodAt,
                ageSeconds: age, retained: rt.last?.retained, partial: anyFresh && Object.values(fieldStatus).some(f => f.stale),
                values: rt.values, fieldStatus, alarms: rt.alarms};
        })};
    }
    private renderMessage(d: IndustrialDevice, r: IndustrialRule, value: unknown) {
        const field = d.fields.find(f => f.id === r.fieldId);
        const template = r.messageTemplate || `${d.name}: ${field?.name || r.fieldId} alarm (${r.operator} ${String(r.threshold)}), current ${String(value)}${field?.unit ? ` ${field.unit}` : ''}`;
        const vars: Record<string, string> = {device: d.name, field: field?.name || r.fieldId, value: String(value), unit: field?.unit || '', rule: r.name};
        return template.replace(/\{(device|field|value|unit|rule)\}/g, (_, key) => vars[key]);
    }
    private resolveNotification(draft?: unknown) {
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return this.config.notification;
        const candidate: any = {...(this.config.notification || {}), ...(draft as any)};
        if (candidate.token === '********') candidate.token = this.config.notification?.token;
        return validateConfig({...this.config, notification: candidate}).notification;
    }
    private async wake(pathname: string, body: unknown, override?: IndustrialConfig['notification']) {
        const n = override || this.config.notification;
        if (!n?.enabled || !n.baseUrl) throw new Error('notifications are not configured');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), n.timeoutMs);
        try {
            const response = await fetch(new URL(pathname, n.baseUrl).toString(), {method: 'POST', headers: {'content-type': 'application/json', ...(n.token ? {authorization: `Bearer ${n.token}`} : {})}, body: JSON.stringify(body), signal: controller.signal});
            return response;
        } finally { clearTimeout(timer); }
    }
    async notificationCapabilities(draft?: unknown) {
        const n = this.resolveNotification(draft);
        if (!n?.baseUrl) return {reachable: false, available: false, enabled: false, capabilities: {context: false, speak: false}, auth: 'unknown', error: 'notifications are not configured'};
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), n.timeoutMs);
        try {
            const r = await fetch(new URL('/api/wake/status', n.baseUrl), {headers: n.token ? {authorization: `Bearer ${n.token}`} : {}, signal: controller.signal});
            const data: any = await r.json().catch(() => ({}));
            const raw = data.capabilities;
            const capabilities = Array.isArray(raw)
                ? {context: raw.includes('context'), speak: raw.includes('speak'), speak_backend: undefined}
                : {context: !!raw?.context, speak: !!raw?.speak, speak_backend: raw?.speak_backend};
            const auth = r.status === 401 ? 'invalid' : data.authenticated === true ? 'valid' : 'unknown';
            const modeSupported = n.mode === 'context' ? capabilities.context : capabilities.speak;
            const firmwareEnabled = data.enabled === undefined ? true : data.enabled === true;
            return {reachable: r.ok, available: !!n.enabled && firmwareEnabled && r.ok && modeSupported && auth !== 'invalid', enabled: data.enabled === true, authenticated: data.authenticated, state: data.state, reason: data.reason, maxContextBytes: data.max_context_bytes ?? raw?.max_context_bytes ?? 25, maxSpeakBytes: data.max_speak_bytes ?? raw?.max_speak_bytes ?? 512, modeSupported, status: r.status, auth, capabilities, deviceType: n.deviceType};
        } catch (e) { return {reachable: false, available: false, enabled: false, capabilities: {context: false, speak: false}, auth: 'unknown', error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'connection failed'}; }
        finally { clearTimeout(timer); }
    }
    async notificationTest(draft?: unknown) { return this.notificationCapabilities(draft); }
    private textLimit(mode: 'context'|'speak') { return mode === 'context' ? 25 : 512; }
    private textBytes(text: string) { return Buffer.byteLength(text, 'utf8'); }
    async sendTest(text: string, draft?: unknown) {
        const n = this.resolveNotification(draft); if (!n?.enabled) { const e: any = new Error('notifications are not enabled'); e.code = 'notification_disabled'; throw e; }
        if (!text) throw new Error('test text must not be empty');
        const bytes = this.textBytes(text), limit = this.textLimit(n.mode);
        if (bytes > limit) { const e: any = new Error(`test text exceeds ${limit} UTF-8 bytes`); e.code = 'text_too_long'; e.textBytes = bytes; e.maxBytes = limit; throw e; }
        const requestId = `test:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const r = await this.wake('/api/wake', {request_id: requestId, mode: n.mode, text, ttl_ms: 15000}, n);
        if (r.status === 409) { const e: any = new Error('device is busy'); e.code = 'busy'; throw e; }
        if (r.status === 401) { const e: any = new Error('device authentication failed (401)'); e.code = 'auth_failed'; throw e; }
        if (r.status === 400 || r.status === 404 || r.status === 422 || r.status === 501) {
            const detail: any = await r.clone().json().catch(() => undefined);
            const message = typeof detail === 'string' ? detail : detail?.message || detail?.error?.message || detail?.error;
            const code = typeof detail === 'object' ? detail?.code || (typeof detail?.error === 'string' ? detail.error : detail?.error?.code) : undefined;
            const explicitlyDisabled = code === 'notification_disabled' || detail?.enabled === false || detail?.state === 'disabled' || detail?.error?.enabled === false || detail?.error?.state === 'disabled';
            if (r.status === 404 && explicitlyDisabled) {
                const e: any = new Error(message || 'notifications are not enabled'); e.code = 'notification_disabled'; throw e;
            }
            if (r.status === 501 || code === 'mode_unsupported' || /mode\s+(?:is\s+)?(?:unsupported|not supported)/i.test(String(message || ''))) {
                const e: any = new Error(message || 'selected notification mode is not supported'); e.code = 'mode_unsupported'; throw e;
            }
        }
        if (r.status !== 202) { const e: any = new Error(`device returned unexpected status (${r.status})`); e.code = 'unexpected_status'; throw e; }
        return {status: 'accepted', accepted: true, requestId, test: true};
    }
    private async deliverAlarm(alarm: Alarm, d: IndustrialDevice, r: IndustrialRule) {
        const n = this.config.notification; if (!n?.enabled || this.deliveries.some(x => x.alarmId === alarm.id)) return;
        const delivery: NotificationDelivery = {id: `delivery:${alarm.id}`, alarmId: alarm.id, ruleId: r.id, deviceId: d.id, status: 'failed', requestedAt: new Date().toISOString()};
        this.deliveries.unshift(delivery); this.deliveries = this.deliveries.slice(0, 100);
        try {
            const text = n.mode === 'context' ? n.context : alarm.message || '';
            delivery.textBytes = this.textBytes(text);
            const limit = this.textLimit(n.mode);
            if (delivery.textBytes > limit) { delivery.error = 'text_too_long'; return; }
            const response = await this.wake('/api/wake', {request_id: delivery.id, mode: n.mode, text, ttl_ms: 15000});
            delivery.responseStatus = response.status;
            if (response.status === 409) delivery.error = 'device busy';
            else if (response.status !== 202) delivery.error = `unexpected status (${response.status})`;
            else delivery.status = 'accepted';
        } catch (e) { delivery.error = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'connection failed'; }
    }
    deliveriesList() { return this.deliveries.map(d => ({...d})); }
    preview(body: any) { return this.evaluate(String(body.topic || ''), body.payload, !!body.retained, false); }
    demo(body: any) { return { ...this.evaluate(String(body.topic || ''), body.payload, !!body.retained, true), simulated: true }; }
    messagesList(limit = 50) { return { items: this.messages.slice(0, Math.max(1, Math.min(limit, 500))), limit: Math.max(1, Math.min(limit, 500)) }; }
    tools(): ToolItem[] {
        const result = (data: unknown) => ({content: [{type: 'text', text: JSON.stringify(data)}]});
        const resolve = (q?: string) => {
            const exact = this.config.devices.find(d => d.id === q);
            const candidates = exact ? [exact] : this.config.devices.filter(d => !q ||
                d.name.toLowerCase().includes(q.toLowerCase()) || d.id.toLowerCase().includes(q.toLowerCase()));
            return {device: candidates.length === 1 ? candidates[0] : undefined, candidates};
        };
        return [{name: 'list_industrial_devices', description: 'List devices, online status and queryable field labels. No private values are included.', paramsSchema: {}, item: async () => {
            return result({devices: this.status().devices.map(d => ({id: d.id, name: d.name, state: d.state,
                partial: d.partial, lastMessageAt: d.lastMessageAt, lastGoodAt: d.lastGoodAt,
                fields: this.config.devices.find(c => c.id === d.id)!.fields.filter(f => f.queryable).map(f => ({id: f.id, name: f.name, unit: f.unit}))}))});
        }}, {name: 'get_industrial_reading', description: 'Read a queryable field with its own quality and freshness. Stale values are historical, not current readings.', paramsSchema: {device: z.string().optional(), field: z.string()}, item: async (p: any) => {
            const r = resolve(p.device);
            if (!r.device) return result({candidates: r.candidates.map(d => ({id: d.id, name: d.name}))});
            const matches = r.device.fields.filter(f => f.queryable && (f.id === p.field || f.name === p.field));
            if (matches.length !== 1) return result({error: 'field is not queryable or is ambiguous', candidates: matches.map(f => ({id: f.id, name: f.name}))});
            const f = matches[0], rt = this.runtimes.get(r.device.id)!, meta = rt.fieldMeta[f.id];
            const fresh = this.fresh(r.device, meta);
            return result({device: {id: r.device.id, name: r.device.name}, field: {id: f.id, name: f.name, unit: f.unit},
                value: rt.values[f.id], receivedAt: meta?.valueReceivedAt, sourceTimestamp: meta?.valueSourceTimestamp,
                latestMessageAt: meta?.receivedAt, quality: meta?.quality, source: 'mqtt', fresh, stale: !fresh});
        }}, {name: 'list_industrial_alarms', description: 'List threshold alarms for queryable fields. Bounded history resets on restart/configuration change.', paramsSchema: {device: z.string().optional(), activeOnly: z.boolean().optional()}, item: async (p: any) => {
            const r = resolve(p.device);
            if (p.device && !r.device) return result({candidates: r.candidates.map(d => ({id: d.id, name: d.name}))});
            const devices = r.device ? [r.device] : this.config.devices;
            this.status();
            const alarms = devices.flatMap(d => this.runtimes.get(d.id)!.alarms.filter(a => (!p.activeOnly || a.active) &&
                d.fields.some(f => f.id === a.fieldId && f.queryable)).map(a => ({id: a.id, ruleId: a.ruleId, name: a.name,
                    deviceId: a.deviceId, fieldId: a.fieldId, active: a.active, startedAt: a.startedAt, recoveredAt: a.recoveredAt,
                    dataFresh: this.fresh(d, this.runtimes.get(d.id)!.fieldMeta[a.fieldId]), renderedMessage: a.message})));
            return result({alarms});
        }}];
    }
}
function parsePayload(text: string): unknown { try {
    return JSON.parse(text);
}
catch {
    return text;
} }
function parseSourceTimestamp(value: unknown): string | undefined { if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
} if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
} return undefined; }
