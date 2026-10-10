#!/usr/bin/env node
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {getLogger} from "./logger";
import {CodeReader} from './mcp_tools/code_reader'
import {WebSocketEndpointTransport} from './transport/ws_endpoint_transport'
import {IndustrialService} from './industrial/industrial_service'
import {listenIndustrialHttp} from './industrial/industrial_http'
import {IndustrialEndpoint} from './industrial/industrial_endpoint'

let logger = getLogger('main')

const projectRoot = __dirname

// Reconnection backoff when running against a XiaoZhi MCP endpoint (mirrors mcp_pipe.py's policy)
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 600_000

main().catch((error) => {
    logger.error(`Fatal error in main(), error: ${error}`);
    process.exit(1);
});

function createMcpServer(industrial?: IndustrialService): McpServer {
    const server = new McpServer({
        name: "sensecraft_data_mcp",
        version: "0.4.0"
    });
    let codeReader = new CodeReader(projectRoot)

    let tools = industrial ? [...industrial.tools()] : [...codeReader.tools()]
    if (!industrial) {
        // Load the legacy PaaS connector only in the legacy mode. It validates
        // ACCESS_ID/ACCESS_KEY at module initialization, so importing it here
        // keeps an industrial instance usable without cloud credentials.
        const {PaasClient} = require('./mcp_tools/paas_client')
        tools = [...new PaasClient().tools(), ...tools]
    }
    for (let tool of tools) {
        server.tool(tool.name, tool.description, tool.paramsSchema, tool.item)
        logger.info(`tool(${tool.name}) add to mcp server successfully!!`)
    }
    return server
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runOverStdio(industrial?: IndustrialService) {
    const server = createMcpServer(industrial)
    const transport = new StdioServerTransport();
    logger.info(`sensecraft_data_mcp is running over stdio...`)
    await server.connect(transport);
}

/**
 * Dials out to a XiaoZhi(小智) "MCP接入点" (e.g. ws://host:port/mcp_endpoint/mcp/?token=xxx)
 * and keeps reconnecting with exponential backoff, similar to the official mcp_pipe.py bridge.
 * A brand new McpServer + transport is built for every attempt so no stale session state leaks
 * across reconnects.
 */
async function runOverWebSocketEndpoint(endpointUrl: string, industrial?: IndustrialService) {
    let backoff = INITIAL_BACKOFF_MS
    let attempt = 0

    while (true) {
        try {
            if (attempt > 0) {
                logger.info(`waiting ${backoff}ms before reconnect attempt ${attempt}...`)
                await sleep(backoff)
            }

            const server = createMcpServer(industrial)
            const transport = new WebSocketEndpointTransport(endpointUrl)
            const closed = new Promise<void>((resolve) => {
                transport.onclose = () => resolve()
            })

            await server.connect(transport)
            logger.info('sensecraft_data_mcp connected to XiaoZhi MCP endpoint')

            await closed
            logger.warn('XiaoZhi MCP endpoint connection closed, will reconnect')
            backoff = INITIAL_BACKOFF_MS
            attempt = 0
        } catch (error) {
            attempt += 1
            logger.error(`XiaoZhi MCP endpoint connection failed (attempt ${attempt}): ${error}`)
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
        }
    }
}

async function main() {
    logger.info('sensecraft_data_mcp is starting...')

    if (process.env.DATA_SOURCE === 'industrial') {
        const industrial = new IndustrialService()
        listenIndustrialHttp(industrial)
        await industrial.connect()
        const endpoint = new IndustrialEndpoint(industrial, () => createMcpServer(industrial))
        await endpoint.start()
        await new Promise<void>(() => {})
        return
    }
    const endpointUrl = process.env.MCP_ENDPOINT
    if (endpointUrl) {
        await runOverWebSocketEndpoint(endpointUrl)
    } else {
        await runOverStdio()
    }
}
