/**
 * Connect model with mcp tools in Node.js
 * 
 * npm install mcp openai
 * node <this-script-path>.js
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import OpenAI from 'openai';

class MCPClient {
    private servers: Map<string, { client: any; tools: any[] }>;
    private toolToServerMap: Map<string, string>;
    private openai: OpenAI;

    constructor() {
        this.servers = new Map();
        this.toolToServerMap = new Map();
        // To authenticate with the model you will need to generate a github gho token in your GitHub settings.
        // Create your github gho token by following instructions here: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
        this.openai = new OpenAI({
            baseURL: "https://models.github.ai/inference",
            apiKey: process.env.GITHUB_TOKEN,
        });
    }

    async connectStdioServer(serverId, command, args, env = {}) {
        const transport = new StdioClientTransport({
            command: command,
            args: args,
            env: { ...process.env, ...env }
        });

        const client = new Client({
            name: "openai-client",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        await client.connect(transport);
        await this.registerServer(serverId, client);
    }

    async connectSseServer(serverId, url, headers = {}) {
        const transport = new SSEClientTransport(new URL(url) as any, { headers } as any);

        const client = new Client({
            name: "openai-client",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        await client.connect(transport);
        await this.registerServer(serverId, client);
    }

    async registerServer(serverId, client) {
        const response = await client.listTools();
        const tools = response.tools;

        this.servers.set(serverId, {
            client: client,
            tools: tools
        });

        for (const tool of tools) {
            this.toolToServerMap.set(tool.name, serverId);
        }

        console.log(`\nConnected to server '${serverId}' with tools:`, tools.map(tool => tool.name));
    }

    async chatWithTools(messages: any[]) {
        if (this.servers.size === 0) {
            throw new Error("No MCP servers connected. Connect to at least one server first.");
        }

        const availableTools: any[] = [];
        for (const [serverId, serverInfo] of this.servers) {
            for (const tool of serverInfo.tools) {
                availableTools.push({
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    }
                });
            }
        }

        while (true) {
            const response = await this.openai.chat.completions.create({
                messages: messages,
                model: "openai/gpt-4.1",
                tools: availableTools,
                response_format: {
                    "type": "text"
                },
                temperature: 1,
                top_p: 1,
            });

            const choice = response.choices[0];
            let hasToolCall = false;

            if (choice.message.tool_calls) {
                for (const tool of choice.message.tool_calls) {
                    hasToolCall = true;
                    const toolName = tool.function.name;
                    const toolArgs = JSON.parse(tool.function.arguments);

                    messages.push({
                        role: "assistant",
                        tool_calls: [{
                            id: tool.id,
                            type: "function",
                            function: {
                                name: tool.function.name,
                                arguments: tool.function.arguments
                            }
                        }]
                    });

                    if (this.toolToServerMap.has(toolName)) {
                        const serverId = this.toolToServerMap.get(toolName);
                        if (!serverId) {
                            console.warn(`No server mapped for tool '${toolName}'.`);
                            continue;
                        }
                        const serverInfo = this.servers.get(serverId);
                        if (!serverInfo) {
                            console.warn(`Server '${serverId}' not found for tool '${toolName}'.`);
                            continue;
                        }
                        const serverClient = serverInfo.client;

                        const callResult = await serverClient.callTool({
                            name: toolName,
                            arguments: toolArgs
                        });

                        console.log(`[Server '${serverId}' call tool '${toolName}' with args ${JSON.stringify(toolArgs)}]: ${JSON.stringify(callResult.content)}`);

                        messages.push({
                            role: "tool",
                            tool_call_id: tool.id,
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(callResult.content)
                                }
                            ]
                        });
                    }
                }
            } else {
                messages.push({
                    role: "assistant",
                    content: choice.message.content
                });
                console.log(`[Model Response]: ${choice.message.content}`);
            }

            if (!hasToolCall) {
                break;
            }
        }
    }

    async cleanup() {
        for (const [serverId, serverInfo] of this.servers) {
            await serverInfo.client.close();
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function main() {
    const client = new MCPClient();
    const messages = [
        {
            role: "system",
            content: "You are someone who reads a Google document."
        },
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: "google_doc 1M9Y8_K2HLyk24YnBIZhc-ntbrb4t6irhdkzKvkq2gHU"
                },
            ],
        },
    ];

    try {
        await client.connectStdioServer(
            "mcp-mefs7z9m",
            "INSERT_COMMAND_HERE",
            [
                "INSERT_ARGUMENTS_HERE",
            ],
            {
            }
        );
        await client.chatWithTools(messages);
    } catch (error) {
        console.error(`\nError: ${error.message}`);
    } finally {
        await client.cleanup();
    }
}

main().catch(console.error); 