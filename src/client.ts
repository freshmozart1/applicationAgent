import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import z from 'zod';
import { GOOGLE_OUTPUT_SCHEMA, GOOGLE_INPUT_SCHEMA } from './schemas.js';
import { Job, Jobs } from './types.js';

// import OpenAI from 'openai';

// const OPENAI_API_KEY = (() => {
//     const tokenFile = path.join(process.cwd(), 'secrets/github_token');
//     try {
//         return fs.readFileSync(tokenFile, 'utf8').trim();
//     } catch (error) {
//         throw new Error(`Error reading GitHub token file at ${tokenFile}: ${error}`);
//     }
// })();

type ServerId = string;
type ToolInfo = { name: string; description?: string; inputSchema: any };

class MCPClient {
    // Multiple server connections (stdio or http)
    private clients = new Map<ServerId, Client>();
    private transports = new Map<ServerId, StdioClientTransport | SSEClientTransport>();
    // Aggregated tools with server ownership
    tools: Array<ToolInfo & { serverId: ServerId }> = [];

    constructor() { }

    private async connectClient(serverId: ServerId, transport: StdioClientTransport | SSEClientTransport) {
        const client = new Client({ name: `openai-client:${serverId}`, version: '1.0.0' });
        await client.connect(transport);
        this.clients.set(serverId, client);
        this.transports.set(serverId, transport);
        const toolsResult = await client.listTools();
        const serverTools = toolsResult.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, serverId }));
        // merge into aggregated list (replace existing entries for same name/serverId)
        this.tools = this.tools.filter(t => t.serverId !== serverId).concat(serverTools);
    }

    async addStdioServer(serverId: ServerId, serverScriptPath: string) {
        try {
            const isPy = serverScriptPath.endsWith('.py');
            const command = isPy ? (process.platform === 'win32' ? 'python' : 'python3') : process.execPath;
            const transport = new StdioClientTransport({ command, args: [serverScriptPath] });
            await this.connectClient(serverId, transport);
        } catch (error) {
            console.error(`Error connecting to MCP stdio server '${serverId}': ${error}`);
            throw error;
        }
    }

    async addHttpServer(serverId: ServerId, url: string, bearerToken?: string, extraHeaders?: Record<string, string>) {
        try {
            if (!/^https?:\/\//i.test(url)) throw new Error('HTTP server URL must start with http:// or https://');
            const headersInit: Record<string, string> = { ...(extraHeaders || {}) };
            if (bearerToken) headersInit['Authorization'] = `Bearer ${bearerToken}`;
            const transport = new SSEClientTransport(new URL(url), {
                requestInit: Object.keys(headersInit).length ? ({ headers: headersInit } as RequestInit) : undefined,
            });
            await this.connectClient(serverId, transport);
        } catch (error) {
            console.error(`Error connecting to MCP HTTP server '${serverId}': ${error}`);
            throw error;
        }
    }

    private getClientByTool(toolName: string): { client: Client; serverId: ServerId } | null {
        const owner = this.tools.find(t => t.name === toolName);
        if (!owner) return null;
        const client = this.clients.get(owner.serverId);
        return client ? { client, serverId: owner.serverId } : null;
    }

    async fetchResumeInspiration(documentId: string) {
        GOOGLE_INPUT_SCHEMA.parse({ documentId });
        const owner = this.getClientByTool('resumeInspiration');
        if (!owner) throw new Error("No connected server provides tool 'resumeInspiration'");
        const result = await owner.client.callTool({ name: 'resumeInspiration', arguments: { documentId } });
        if (!result.content) throw new Error('Tool response missing content');
        if (result.isError) throw new Error(`Error fetching resume inspiration: ${JSON.stringify(result.content)}`);
        return result.content;
    }

    async fetchGoogleDoc(documentId: string) {
        // Validate input
        GOOGLE_INPUT_SCHEMA.parse({ documentId });

        const owner = this.getClientByTool('googleDoc');
        if (!owner) throw new Error("No connected server provides tool 'googleDoc'");
        const result = await owner.client.callTool({ name: 'googleDoc', arguments: { documentId } });
        if (!result.content) throw new Error('Tool response missing content');
        if (result.isError) throw new Error(`Error fetching Google Doc: ${JSON.stringify(result.content)}`);
        if (!result.structuredContent) {
            throw new Error('Tool response missing structuredContent');
        }
        // Validate output against result schema
        const parsed = await z.object(GOOGLE_OUTPUT_SCHEMA).safeParseAsync(result.structuredContent);
        if (!parsed.success) {
            throw new Error(`Invalid tool structuredContent: ${parsed.error.message}`);
        }
        return parsed.data;
    }

    async fetchJobs() {
        const owner = this.getClientByTool('jobs');
        if (!owner) throw new Error("No connected server provides tool 'jobs'");
        const result = await owner.client.callTool({ name: 'jobs' });
        if (!result.content) throw new Error('Tool response missing content');
        if (result.isError) throw new Error(`Error fetching jobs: ${JSON.stringify(result.content)}`);
        return result.content;
    }

    async fetchResume(textBlocks: string[], job: Job) {
        const owner = this.getClientByTool('resume');
        if (!owner) throw new Error("No connected server provides tool 'resume'");
        const result = await owner.client.callTool({ name: 'resume', arguments: { textBlocks, job } });
        if (!result.content) throw new Error('Tool response missing content');
        if (result.isError) throw new Error(`Error fetching resume: ${JSON.stringify(result.content)}`);
        return result.content;
    }

    async processQuery(query: string) {
        const sQuery = query.trim().split(' ');
        const toolName = this.tools.find(t => sQuery[0] === t.name)?.name || '';
        if (toolName) {
            const functionName = `fetch${toolName[0].toUpperCase() + toolName.slice(1)}`;
            const parameters = sQuery.slice(1);
            const method = (this as any)[functionName];
            if (typeof method === 'function') {
                console.log(`calling ${functionName} with parameters: ${JSON.stringify(parameters)}`);
                return await method.call(this, ...parameters);
            }
        }
    }

    async cleanUp() {
        for (const [serverId, client] of this.clients) {
            try {
                await client.close();
            } catch (e) {
                console.error(`Error closing client '${serverId}':`, e);
            }
        }
    }
}

(async () => {
    if (process.argv.length < 3) return console.log('Usage: node client.js <server1> [server2 ...]  # each server is a .js/.py script path or an http(s) URL');
    const mcpClient = new MCPClient();
    try {
        const targets = process.argv.slice(2);
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const id = 'srv-' + i;
            if (target.endsWith('.js') || target.endsWith('.py')) {
                await mcpClient.addStdioServer(id, target);
            } else {
                throw new Error(`Unknown server type for target: ${target}`);
            }
        }
        console.log(mcpClient.tools.map(t => `Server: ${t.serverId} -> Tool: ${t.name}, Description: ${t.description || 'No description'}`).join('\n'));
        const doc = await mcpClient.processQuery('resumeInspiration 1M9Y8_K2HLyk24YnBIZhc-ntbrb4t6irhdkzKvkq2gHU');
        const jobs = JSON.parse((await mcpClient.processQuery('jobs'))[0].resource.text) as Jobs;
        console.log('Jobs:', jobs.length);
        console.log(doc)
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mcpClient.cleanUp();
        process.exit(0);
    }
})();