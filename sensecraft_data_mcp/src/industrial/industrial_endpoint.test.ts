import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {WebSocketServer,WebSocket} from 'ws'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {IndustrialService} from './industrial_service'
import {IndustrialEndpoint} from './industrial_endpoint'
import {createIndustrialHttpServer} from './industrial_http'

function put(port:number,config:unknown){return new Promise<number>((resolve,reject)=>{const data=JSON.stringify(config);const req=http.request({host:'127.0.0.1',port,path:'/api/industrial/config',method:'PUT',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode||0))});req.on('error',reject);req.end(data)})}
async function listening(server:WebSocketServer){if(server.address())return;await new Promise<void>((resolve,reject)=>{const onError=(e:Error)=>{server.off('listening',onListening);reject(e)};const onListening=()=>{server.off('error',onError);resolve()};server.once('error',onError);server.once('listening',onListening)})}
async function waitFor(check:()=>boolean,timeout=2500){const deadline=Date.now()+timeout;while(!check()){if(Date.now()>deadline)throw new Error('condition timed out');await new Promise(resolve=>setTimeout(resolve,25))}}

test('HTTP PUT switches A to B and B close reconnects locally',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'endpoint-'))
    const service=new IndustrialService(path.join(dir,'config.json'))
    const a=new WebSocketServer({port:0});const b=new WebSocketServer({port:0})
    const aSockets:WebSocket[]=[];const bSockets:WebSocket[]=[];let aConnections=0;let bConnections=0
    a.on('connection',socket=>{aConnections++;aSockets.push(socket)});b.on('connection',socket=>{bConnections++;bSockets.push(socket)})
    await Promise.all([listening(a),listening(b)])
    const httpServer=createIndustrialHttpServer(service);await new Promise<void>((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)})
    const endpoint=new IndustrialEndpoint(service,()=>new McpServer({name:'test',version:'1'}))
    t.after(async()=>{await endpoint.close();for(const socket of [...aSockets,...bSockets])socket.close();await new Promise<void>(resolve=>httpServer.close(()=>resolve()));await new Promise<void>(resolve=>a.close(()=>resolve()));await new Promise<void>(resolve=>b.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true})})
    await endpoint.start()
    const port=(httpServer.address() as any).port;const base={mqtt:{url:''},mcp:{endpoint:''},devices:[]};const ap=(a.address() as any).port;const bp=(b.address() as any).port
    assert.equal(await put(port,{...base,mcp:{endpoint:`ws://127.0.0.1:${ap}`}}),200);await waitFor(()=>aConnections===1)
    assert.equal(await put(port,{...base,mcp:{endpoint:`ws://127.0.0.1:${bp}`}}),200);await waitFor(()=>bConnections===1);await waitFor(()=>aSockets[0].readyState===WebSocket.CLOSED)
    bSockets[0].close();await waitFor(()=>bConnections===2)
})
