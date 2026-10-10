import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {IndustrialService} from './industrial_service'
import {createIndustrialHttpServer} from './industrial_http'

const iso = (n:number) => new Date(n).toISOString()
function makeService(baseUrl:string, mode:'context'|'speak'='speak') {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'industrial-notification-')), 'config.json')
  const s = new IndustrialService(file)
  s.update({mqtt:{url:''},mcp:{},notification:{enabled:true,deviceType:'watcher',baseUrl,token:'device-secret',mode,context:'工业报警',timeoutMs:80},devices:[{
    id:'pump',name:'Pump',topic:'factory/pump',onlineTimeoutSeconds:30,qualityPath:'quality',goodQualityValues:['good'],
    fields:[{id:'temp',name:'Temperature',path:'value',type:'number',queryable:true,unit:'C'},{id:'secret',name:'Secret',path:'secret',type:'number',queryable:false}],
    rules:[{id:'hot',name:'High temperature',fieldId:'temp',operator:'gt',threshold:80,durationSeconds:0,hysteresis:2,enabled:true,messageTemplate:'{device} {field}={value}{unit} ({rule})'},
      {id:'private',name:'Private threshold',fieldId:'secret',operator:'gt',threshold:50,durationSeconds:0,hysteresis:0,enabled:true,messageTemplate:'PRIVATE {value}'}]
  }]})
  return s
}
async function serverWith(handler:(req:http.IncomingMessage,res:http.ServerResponse)=>void) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  return {server, url:`http://127.0.0.1:${(server.address() as any).port}`}
}
async function close(server:http.Server) { await new Promise<void>(resolve=>server.close(()=>resolve())) }
async function eventually(check:()=>boolean, ms=500) { const end=Date.now()+ms; while(!check()){if(Date.now()>end) throw new Error('timed out waiting for notification'); await new Promise(r=>setTimeout(r,5))} }

test('threshold sends exactly once, recovery allows a new delivery, with exact wake body', async t=>{
  const requests:any[]=[]
  const mock=await serverWith((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(body)});res.writeHead(req.url==='/api/wake'?202:200,{'content-type':'application/json'});res.end('{}')})})
  t.after(()=>close(mock.server)); const s=makeService(mock.url)
  s.ingest('factory/pump',{value:90,quality:'good'},false,false,iso(Date.now())); await eventually(()=>s.deliveriesList().length===1)
  s.ingest('factory/pump',{value:91,quality:'good'},false,false,iso(Date.now()+1)); await new Promise(r=>setTimeout(r,15)); assert.equal(s.deliveriesList().length,1)
  s.ingest('factory/pump',{value:70,quality:'good'},false,false,iso(Date.now()+2)); s.ingest('factory/pump',{value:90,quality:'good'},false,false,iso(Date.now()+3)); await eventually(()=>s.deliveriesList().length===2)
  await eventually(()=>requests.length===2); assert.equal(requests[0].url,'/api/wake'); assert.equal(requests[0].auth,'Bearer device-secret'); assert.deepEqual(Object.keys(requests[0].body).sort(),['mode','request_id','text','ttl_ms']); assert.equal(requests[0].body.mode,'speak'); assert.equal(requests[0].body.text,'Pump Temperature=90C (High temperature)'); assert.equal(requests[0].body.ttl_ms,15000)
})

test('bad quality, retained, preview and demo never send', async t=>{
  let count=0; const mock=await serverWith((_req,res)=>{count++;res.writeHead(200);res.end('{}')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  s.ingest('factory/pump',{value:90,quality:'good'},true,false); s.ingest('factory/pump',{value:90,quality:'bad'},false,false); s.ingest('factory/pump',{value:90,quality:'good'},false,true); s.preview({topic:'factory/pump',payload:{value:90,quality:'good'}}); s.demo({topic:'factory/pump',payload:{value:90,quality:'good'}})
  await new Promise(r=>setTimeout(r,30)); assert.equal(count,0); assert.equal(s.deliveriesList().length,0)
})

test('busy is recorded as failed without retry and timeout is failed', async t=>{
  let mode:'busy'|'timeout'='busy'; const mock=await serverWith((req,res)=>{if(mode==='timeout') return; res.writeHead(409);res.end('{}')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  s.ingest('factory/pump',{value:90,quality:'good'}); await eventually(()=>s.deliveriesList()[0]?.error==='device busy'); assert.equal(s.deliveriesList()[0].status,'failed');
  mode='timeout'; s.ingest('factory/pump',{value:70,quality:'good'}); s.ingest('factory/pump',{value:90,quality:'good'}); await eventually(()=>s.deliveriesList()[0]?.error==='timeout'); assert.equal(s.deliveriesList()[0].status,'failed')
})

test('notification test probes status and send-test is explicit', async t=>{
  const requests:any[]=[]; const mock=await serverWith((req,res)=>{requests.push({method:req.method,url:req.url,auth:req.headers.authorization});res.writeHead(req.url==='/api/wake'?202:200,{'content-type':'application/json'});res.end(JSON.stringify({enabled:true,authenticated:true,capabilities:{context:true,speak:true,speak_backend:'local_server_device_call_tts'}}))}); t.after(()=>close(mock.server)); const s=makeService(mock.url,'context')
  const caps=await s.notificationTest(); assert.deepEqual(caps.capabilities,{context:true,speak:true,speak_backend:'local_server_device_call_tts'}); assert.equal(caps.available,true); assert.equal(caps.auth,'valid'); assert.equal(requests[0].method,'GET'); assert.equal(requests[0].url,'/api/wake/status'); assert.equal(requests.length,1)
  const sent=await s.sendTest('test alarm'); assert.equal(sent.status,'accepted'); assert.equal(requests[1].method,'POST'); assert.deepEqual(requests[1],{method:'POST',url:'/api/wake',auth:'Bearer device-secret'}); assert.equal(s.deliveriesList().length,0)
})

test('notification capabilities use nested firmware text limits', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({enabled:true,authenticated:true,capabilities:{context:true,speak:true,max_context_bytes:17,max_speak_bytes:333}}))}); t.after(()=>close(mock.server)); const s=makeService(mock.url,'context')
  const caps:any=await s.notificationTest(); assert.equal(caps.maxContextBytes,17); assert.equal(caps.maxSpeakBytes,333)
})

test('HTTP notification test accepts draft config without persisting it', async t=>{
  const device=await serverWith((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({enabled:true,authenticated:true,capabilities:{context:true,speak:false,speak_backend:'local_server_device_call_tts'}}))})
  const s=makeService('http://127.0.0.1:1'); const app=createIndustrialHttpServer(s); await new Promise<void>((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve)}); t.after(()=>Promise.all([close(device.server),close(app)]))
  const port=(app.address() as any).port; const response=await fetch(`http://127.0.0.1:${port}/api/industrial/notification/test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,deviceType:'watcher',baseUrl:device.url,mode:'context'})}); const body:any=await response.json(); assert.equal(response.status,200); assert.equal(body.data.available,true); assert.equal(s.config.notification?.baseUrl,'http://127.0.0.1:1')
})

test('send-test reports device authentication failure explicitly', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(401);res.end('unauthorized')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('test alarm'), (error:any) => error.code === 'auth_failed' && /401/.test(error.message))
})

test('send-test reports disabled notifications with a structured code', async t=>{
  const s=makeService('http://127.0.0.1:1'); s.update({notification:{enabled:false}})
  const app=createIndustrialHttpServer(s); await new Promise<void>((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve)}); t.after(()=>close(app))
  const port=(app.address() as any).port; const response=await fetch(`http://127.0.0.1:${port}/api/industrial/notification/send-test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'test alarm'})}); const body:any=await response.json()
  assert.equal(response.status,502); assert.equal(body.error.code,'notification_disabled')
})

test('send-test reports an unsupported device mode with a structured code', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'mode_unsupported',message:'mode is not supported'}}))}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('test alarm'), (error:any) => error.code === 'mode_unsupported')
})

test('send-test maps explicit 501 mode rejection', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(501);res.end('not implemented')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('test alarm'), (error:any) => error.code === 'mode_unsupported')
})

test('send-test maps an explicitly disabled 404', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({enabled:false,state:'disabled'}))}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('test alarm'), (error:any) => error.code === 'notification_disabled')
})

test('send-test keeps an unknown 404 as unexpected status', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(404);res.end('missing')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('test alarm'), (error:any) => error.code === 'unexpected_status' && /404/.test(error.message))
})

test('send-test rejects speak text over 512 UTF-8 bytes before HTTP', async t=>{
  let calls=0; const mock=await serverWith((_req,res)=>{calls++;res.writeHead(202);res.end('{}')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('测'.repeat(257)), (error:any) => error.code === 'text_too_long' && error.textBytes > 512)
  assert.equal(calls,0)
})

test('HTTP 200 wake response is not accepted', async t=>{
  const mock=await serverWith((_req,res)=>{res.writeHead(200);res.end('{}')}); t.after(()=>close(mock.server)); const s=makeService(mock.url)
  await assert.rejects(() => s.sendTest('test alarm'), (error:any) => error.code === 'unexpected_status' && /200/.test(error.message))
})

test('HTTP send-test uses unsaved draft endpoint/token without persisting', async t=>{
  let auth=''; const device=await serverWith((req,res)=>{auth=String(req.headers.authorization||'');res.writeHead(202);res.end('{}')})
  const s=makeService('http://127.0.0.1:1'); const app=createIndustrialHttpServer(s); await new Promise<void>((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve)}); t.after(()=>Promise.all([close(device.server),close(app)]))
  const port=(app.address() as any).port; const draft={enabled:true,deviceType:'watcher',baseUrl:device.url,token:'draft-key',mode:'context',context:'测试报警',timeoutMs:80}; const response=await fetch(`http://127.0.0.1:${port}/api/industrial/notification/send-test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({notification:draft,text:'测试报警'})}); const body:any=await response.json(); assert.equal(response.status,202); assert.equal(body.data.accepted,true); assert.equal(auth,'Bearer draft-key'); assert.equal(s.config.notification?.baseUrl,'http://127.0.0.1:1'); assert.equal(s.config.notification?.token,'device-secret')
})

test('token masking roundtrip and UTF-8 context limit', async()=>{
  const s=makeService('http://127.0.0.1:1'); const masked:any=s.maskedConfig(); assert.equal(masked.notification.token,'********'); assert.equal(masked.notification.tokenConfigured,true); s.update(masked); assert.equal(s.config.notification?.token,'device-secret'); s.update({notification:{token:''}}); assert.equal(s.config.notification?.token,'')
  assert.throws(()=>s.update({notification:{enabled:true,deviceType:'watcher',baseUrl:'http://127.0.0.1:1',mode:'context',context:'一'.repeat(26),timeoutMs:80}}),/25 UTF-8 bytes/)
})

test('MCP alarms expose rendered message only for queryable fields', async()=>{
  const s=makeService('http://127.0.0.1:1'); s.ingest('factory/pump',{value:90,secret:99,quality:'good'}); await new Promise(r=>setTimeout(r,20)); const tool:any=s.tools().find(x=>x.name==='list_industrial_alarms'); const text=(await tool.item({device:'pump'})).content[0].text; assert.match(text,/Pump Temperature=90C \(High temperature\)/); assert.doesNotMatch(text,/PRIVATE|secret|99/)
})
