import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {IndustrialService} from './industrial_service'
import {WebSocketEndpointTransport} from '../transport/ws_endpoint_transport'

export type McpFactory=()=>McpServer

export class IndustrialEndpoint {
    private endpoint?:string
    private epoch=0
    private timer?:NodeJS.Timeout
    private transport?:WebSocketEndpointTransport
    private server?:McpServer
    private started=false

    constructor(private readonly service:IndustrialService,private readonly factory:McpFactory){
        this.endpoint=service.config.mcp.endpoint||process.env.MCP_ENDPOINT
        service.onConfigUpdated=async config=>this.replace(config.mcp.endpoint)
    }

    async start(){this.started=true;const epoch=++this.epoch;if(this.endpoint)await this.connect(epoch)}

    async replace(endpoint?:string){
        if(this.started&&endpoint===this.endpoint)return
        this.endpoint=endpoint
        const epoch=++this.epoch
        this.cancelRetry()
        await this.closeCurrent()
        if(this.started&&endpoint)await this.connect(epoch)
    }

    private async connect(epoch:number){
        if(epoch!==this.epoch||!this.endpoint)return
        const transport=new WebSocketEndpointTransport(this.endpoint)
        const server=this.factory()
        this.transport=transport
        this.server=server
        transport.onclose=()=>this.scheduleRetry(epoch)
        transport.onerror=()=>this.scheduleRetry(epoch)
        try{await server.connect(transport)}catch{this.scheduleRetry(epoch)}
        if(epoch!==this.epoch){await transport.close();await server.close()}
    }

    private scheduleRetry(epoch:number){
        if(epoch!==this.epoch||this.timer||!this.endpoint)return
        this.timer=setTimeout(()=>{this.timer=undefined;void this.reconnect(epoch)},1000)
    }

    private async reconnect(epoch:number){
        if(epoch!==this.epoch||!this.endpoint)return
        await this.closeCurrent()
        await this.connect(epoch)
    }

    private cancelRetry(){if(this.timer){clearTimeout(this.timer);this.timer=undefined}}

    private async closeCurrent(){
        const transport=this.transport;const server=this.server
        this.transport=undefined;this.server=undefined
        if(transport)await transport.close()
        if(server)await server.close()
    }

    async close(){this.started=false;this.epoch++;this.cancelRetry();await this.closeCurrent()}
}
