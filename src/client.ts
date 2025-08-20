import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import z from 'zod';
import { GOOGLE_OUTPUT_SCHEMA, GOOGLE_INPUT_SCHEMA } from './schemas.js';

// import OpenAI from 'openai';
// import fs from 'node:fs';
// import path from "path";

// const OPENAI_API_KEY = (() => {
//     const tokenFile = path.join(process.cwd(), 'secrets/github_token');
//     try {
//         return fs.readFileSync(tokenFile, 'utf8').trim();
//     } catch (error) {
//         throw new Error(`Error reading GitHub token file at ${tokenFile}: ${error}`);
//     }
// })();

class MCPClient {
    private mcp: Client;
    // private openai: OpenAI;
    private transport: StdioClientTransport | null = null;
    tools: Array<{
        name: string;
        description?: string;
        inputSchema: any;
    }> = [];

    constructor() {
        this.mcp = new Client({ name: "openai-client", version: "1.0.0" });
        // this.openai = new OpenAI({
        //     baseURL: "https://models.github.ai/inference",
        //     apiKey: OPENAI_API_KEY,
        // });
    }

    async connectToServer(serverScriptPath: string) {
        try {
            const isJs = serverScriptPath.endsWith('.js');
            const isPy = serverScriptPath.endsWith('.py');
            if (!isJs && !isPy) throw new Error('Server script must be a .js or .py file.');
            const command = isPy ? process.platform === 'win32' ? 'python' : 'python3' : process.execPath;
            this.transport = new StdioClientTransport({
                command,
                args: [serverScriptPath]
            });
            await this.mcp.connect(this.transport);
            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }));
        } catch (error) {
            console.error(`Error connecting to MCP server: ${error}`);
            throw error;
        }
    }

    async fetchResumeInspiration(documentId: string) {
        GOOGLE_INPUT_SCHEMA.parse({ documentId });
        const result = await this.mcp.callTool({
            name: 'resumeInspiration',
            arguments: { documentId }
        });

        if (!result.content) throw new Error('Tool response missing content');
        if (result.isError) throw new Error(`Error fetching resume inspiration: ${JSON.stringify(result.content)}`);
        return result.content;
    }

    async fetchGoogleDoc(documentId: string) {
        // Validate input
        GOOGLE_INPUT_SCHEMA.parse({ documentId });

        const result = await this.mcp.callTool({
            name: 'googleDoc',
            arguments: { documentId }
        });
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

    async processQuery(query: string) {
        const googleDoc = query.trim().match(/^googleDoc\s+(\S+)/i);
        const resumeInspiration = query.trim().match(/^resumeInspiration\s+(\S+)/i);
        if (googleDoc) return await this.fetchGoogleDoc(googleDoc[1]);
        if (resumeInspiration) return await this.fetchResumeInspiration(resumeInspiration[1]);
    }

    async cleanUp() {
        await this.mcp.close();
    }
}

(async () => {
    if (process.argv.length < 3) return console.log('Usage: node client.js <path_to_server_script>');
    const mcpClient = new MCPClient();
    try {
        await mcpClient.connectToServer(process.argv[2]);
        console.log(mcpClient.tools.map(t => `Tool: ${t.name}, Description: ${t.description || 'No description'}`).join('\n'));
        const doc = await mcpClient.processQuery('resumeInspiration 1M9Y8_K2HLyk24YnBIZhc-ntbrb4t6irhdkzKvkq2gHU');
        console.log('Document fetched successfully:', doc);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mcpClient.cleanUp();
        process.exit(0);
    }
})();