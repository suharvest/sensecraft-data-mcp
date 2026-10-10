import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {IndustrialService, IndustrialConfig} from './industrial_service'

const baseTime = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (ms:number) => new Date(ms).toISOString()

function config():IndustrialConfig {
  return {mqtt:{url:''},mcp:{},devices:[{
    id:'line-1', name:'Line 1', topic:'missionpack/v1/gw-1/points/#', onlineTimeoutSeconds:30,
    qualityPath:'quality', goodQualityValues:['good'], timestampPath:'source_timestamp', onlinePolicy:'valid_data',
    fields:[
      {id:'temperature',name:'Temperature',topic:'missionpack/v1/gw-1/points/temperature',path:'value',type:'number',queryable:true},
      {id:'pressure',name:'Pressure',topic:'missionpack/v1/gw-1/points/pressure',path:'value',type:'number',queryable:true},
      {id:'running',name:'Running',topic:'missionpack/v1/gw-1/points/running',path:'value',type:'boolean',queryable:true},
      {id:'secret',name:'Secret',topic:'missionpack/v1/gw-1/points/secret',path:'value',type:'number',queryable:false}
    ],
    rules:[
      {id:'hot',name:'High temperature',fieldId:'temperature',operator:'gt',threshold:80,durationSeconds:10,hysteresis:5,enabled:true},
      {id:'secret-rule',name:'Hidden alarm',fieldId:'secret',operator:'gt',threshold:50,durationSeconds:0,hysteresis:0,enabled:true}
    ]
  }]}
}

function service():IndustrialService {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'industrial-regression-')),'config.json')
  const s = new IndustrialService(file)
  s.update(config())
  return s
}

function point(topic:string,value:unknown,at:number,quality='good',sourceAt=at) {
  return {topic,payload:{value,quality,source_timestamp:iso(sourceAt)},retained:false,receivedAt:iso(at)}
}

test('maps per-field topics and keeps each field freshness independent',()=>{
  const s = service(); const originalNow = Date.now
  try {
    Date.now = () => baseTime
    s.ingest(point('missionpack/v1/gw-1/points/temperature',72,baseTime).topic,point('missionpack/v1/gw-1/points/temperature',72,baseTime).payload,false,false,iso(baseTime))
    s.ingest(point('missionpack/v1/gw-1/points/pressure',1.8,baseTime+1000).topic,point('missionpack/v1/gw-1/points/pressure',1.8,baseTime+1000).payload,false,false,iso(baseTime+1000))
    const d:any = s.status().devices[0]
    assert.equal(d.values.temperature,72); assert.equal(d.values.pressure,1.8)
    assert.equal(d.fieldStatus.temperature.fresh,true); assert.equal(d.fieldStatus.pressure.fresh,true)
    assert.equal(d.partial,true)
  } finally { Date.now = originalNow }
})

test('device identity is still required when a field has an explicit topic',()=>{
  const s = service(); const originalNow = Date.now
  try {
    Date.now = () => baseTime
    s.update({devices:[{...s.config.devices[0],idPath:'device_id',idValue:'gw-1'}]})
    s.ingest('missionpack/v1/gw-1/points/temperature',{device_id:'wrong',value:40,quality:'good',source_timestamp:iso(baseTime)},false,false,iso(baseTime))
    assert.equal((s.status().devices[0] as any).values.temperature,undefined)
    s.ingest('missionpack/v1/gw-1/points/temperature',{device_id:'gw-1',value:42,quality:'good',source_timestamp:iso(baseTime)},false,false,iso(baseTime))
    assert.equal((s.status().devices[0] as any).values.temperature,42)
  } finally { Date.now = originalNow }
})

test('bad, retained, invalid, missing and duplicate source values do not replace valid readings',()=>{
  const s = service(); const originalNow = Date.now
  try {
    Date.now = () => baseTime
    const first = point('missionpack/v1/gw-1/points/temperature',72,baseTime)
    s.ingest(first.topic,first.payload,false,false,iso(baseTime))
    const bad = point(first.topic,99,baseTime+1000,'bad'); s.ingest(bad.topic,bad.payload,false,false,iso(baseTime+1000))
    const retained = point(first.topic,88,baseTime+2000); s.ingest(retained.topic,retained.payload,true,false,iso(baseTime+2000))
    const invalid = point(first.topic,'NaN',baseTime+3000); s.ingest(invalid.topic,invalid.payload,false,false,iso(baseTime+3000))
    const missing = {value:91,quality:'good'}; s.ingest(first.topic,missing,false,false,iso(baseTime+4000))
    const duplicate = point(first.topic,73,baseTime+5000,'good',baseTime); s.ingest(duplicate.topic,duplicate.payload,false,false,iso(baseTime+5000))
    const d:any = s.status().devices[0]
    assert.equal(d.values.temperature,72); assert.equal(d.fieldStatus.temperature.fresh,false); assert.equal(d.retained,false)
    const bool = point('missionpack/v1/gw-1/points/running','maybe',baseTime+6000); s.ingest(bool.topic,bool.payload,false,false,iso(baseTime+6000))
    assert.equal(d.values.running,undefined)
  } finally { Date.now = originalNow }
})

test('source timestamp advances only with newer valid data',()=>{
  const s = service(); const originalNow = Date.now
  try {
    Date.now = () => baseTime
    s.ingest('missionpack/v1/gw-1/points/temperature',{value:70,quality:'good',source_timestamp:iso(baseTime)},false,false,iso(baseTime))
    s.ingest('missionpack/v1/gw-1/points/temperature',{value:71,quality:'good'},false,false,iso(baseTime+1000))
    s.ingest('missionpack/v1/gw-1/points/temperature',{value:72,quality:'good',source_timestamp:iso(baseTime-1000)},false,false,iso(baseTime+2000))
    const d:any = s.status().devices[0]
    assert.equal(d.values.temperature,70); assert.equal(d.fieldStatus.temperature.fresh,false)
  } finally { Date.now = originalNow }
})

test('online policy distinguishes any message from valid data and ages out after clock advances',()=>{
  const s = service(); const originalNow = Date.now
  try {
    let clock = baseTime; Date.now = () => clock
    s.ingest('missionpack/v1/gw-1/points/temperature',{value:72,quality:'bad',source_timestamp:iso(clock)},false,false,iso(clock))
    assert.equal(s.status().devices[0].state,'offline')
    s.update({devices:[{...s.config.devices[0],onlinePolicy:'message'}]})
    s.ingest('missionpack/v1/gw-1/points/temperature',{value:72,quality:'bad',source_timestamp:iso(clock)},false,false,iso(clock))
    assert.equal(s.status().devices[0].state,'online')
    clock += 31_000; assert.equal(s.status().devices[0].state,'offline')
  } finally { Date.now = originalNow }
})

test('duration resets on bad data and hysteresis controls recovery',()=>{
  const s = service(); const originalNow = Date.now
  try {
    let clock = baseTime; Date.now = () => clock
    const send = (value:unknown,quality='good') => s.ingest('missionpack/v1/gw-1/points/temperature',{value,quality,source_timestamp:iso(clock)},false,false,iso(clock))
    send(90); clock += 5_000; send(90); assert.equal(s.status().devices[0].alarms.length,0)
    send(90,'bad'); clock += 6_000; send(90); assert.equal(s.status().devices[0].alarms.length,0)
    clock += 10_000; send(90); assert.equal(s.status().devices[0].alarms[0].active,true)
    clock += 1_000; send(78); assert.equal(s.status().devices[0].alarms[0].active,true)
    clock += 1_000; send(74); assert.equal(s.status().devices[0].alarms[0].active,false)
  } finally { Date.now = originalNow }
})

test('read-only MCP tools hide non-queryable values and alarms',async()=>{
  const s = service(); const originalNow = Date.now
  try {
    Date.now = () => baseTime
    s.ingest('missionpack/v1/gw-1/points/secret',{value:99,quality:'good',source_timestamp:iso(baseTime)},false,false,iso(baseTime))
    const list:any = s.tools().find(x=>x.name==='list_industrial_devices')
    const read:any = s.tools().find(x=>x.name==='get_industrial_reading')
    const alarms:any = s.tools().find(x=>x.name==='list_industrial_alarms')
    const listText = (await list.item({})).content[0].text
    assert.doesNotMatch(listText,/secret|Hidden alarm|99/)
    const readText = (await read.item({device:'line-1',field:'secret'})).content[0].text
    assert.match(readText,/not queryable/)
    const alarmsText = (await alarms.item({device:'line-1'})).content[0].text
    assert.doesNotMatch(alarmsText,/secret|Hidden alarm/)
  } finally { Date.now = originalNow }
})

test('masked password and endpoint roundtrip preserves secrets and allows clearing',()=>{
  const s = service(); s.update({mqtt:{url:'',password:'secret'},mcp:{endpoint:'wss://example.test/mcp?token=abc'}})
  const masked:any = s.maskedConfig(); assert.equal(masked.mqtt.password,'********'); assert.match(masked.mcp.endpoint,/token=\*+/)
  s.update(masked); assert.equal(s.config.mqtt.password,'secret'); assert.match(s.config.mcp.endpoint,/token=abc/)
  s.update({mqtt:{password:''},mcp:{endpoint:''}}); assert.equal(s.config.mqtt.password,''); assert.equal(s.config.mcp.endpoint,'')
})

test('validates broker and MCP hosts and defaults TLS verification on',()=>{
  const s = service()
  // update() reconnects asynchronously in production; this validation test
  // must not open a real MQTT socket or leave a client handle behind.
  s.connect = async () => {}
  s.update({mqtt:{url:'mqtts://broker.example.test:8883'}})
  assert.equal(s.config.mqtt.tlsRejectUnauthorized,true)
  const before = structuredClone(s.config)
  assert.throws(()=>s.update({mqtt:{url:'mqtt://user:pass@broker.example.test:1883'}}),/Enter MQTT credentials/)
  assert.deepEqual(s.config,before)
  assert.throws(()=>s.update({mcp:{endpoint:'wss://'}}),/Invalid URL/)
  assert.deepEqual(s.config,before)
})

test('rejects duplicate and unknown rule field configurations',()=>{
  const s = service()
  assert.throws(()=>s.update({devices:[s.config.devices[0],{...s.config.devices[0]}]}),/duplicate device id/)
  assert.throws(()=>s.update({devices:[{...s.config.devices[0],rules:[{...s.config.devices[0].rules[0],fieldId:'missing'}]}]}),/unknown field/)
})

test('write failure leaves persisted and in-memory config unchanged',()=>{
  const s = service(); const before = structuredClone(s.config); const original = fs.writeFileSync
  try {
    ;(fs as any).writeFileSync = () => { throw new Error('disk full') }
    assert.throws(()=>s.update({...before,mcp:{endpoint:'ws://example.test/mcp'}}),/disk full/)
    assert.deepEqual(s.config,before)
  } finally { (fs as any).writeFileSync = original }
})

test('demo is an isolated trial and does not change real runtime status or messages',()=>{
  const s = service(); const before = structuredClone(s.status()); const count = s.messages.length
  const result:any = s.demo({topic:'missionpack/v1/gw-1/points/temperature',payload:{value:99,quality:'good',source_timestamp:iso(baseTime)}})
  assert.equal(result.simulated,true); assert.deepEqual(s.status(),before); assert.equal(s.messages.length,count)
})
