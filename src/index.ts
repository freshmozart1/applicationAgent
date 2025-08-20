/*

DON'T CONSOLE.LOG!

*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { docs_v1, docs } from '@googleapis/docs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GOOGLE_OUTPUT_SCHEMA, GOOGLE_INPUT_SCHEMA } from './schemas.js';
import { googleAuth } from './auth.js';
const SERVER = new McpServer({
    name: 'applicationAgentMCPServer',
    version: '1.0.0'
});

let CACHED_DOCS_CLIENT: docs_v1.Docs;

async function getDoc(documentId: string) {
    if (!CACHED_DOCS_CLIENT) CACHED_DOCS_CLIENT = docs({ version: 'v1', auth: (await googleAuth()) as any });
    return await CACHED_DOCS_CLIENT.documents.get({ documentId, includeTabsContent: true });
}

SERVER.registerTool('resumeInspiration', {
    description: 'Get inspirational text blocks for resume writing from a Google Doc',
    inputSchema: GOOGLE_INPUT_SCHEMA.shape
}, async ({ documentId }) => {
    // Note: Servers cannot "call" another tool via MCP; reuse the same underlying fetch logic as 'googleDoc'.
    try {
        const docResponse = await getDoc(documentId);
        const tabs = docResponse.data.tabs || [];
        const extractedParagraphs = [];
        for (const tab of tabs) {
            if (!tab.documentTab || !tab.documentTab.body?.content) continue;
            for (const block of tab.documentTab.body.content) {
                if (
                    block.paragraph
                    && block.paragraph.elements
                    && block.paragraph.elements[0].textRun?.content
                    && block.paragraph.elements[0].textRun.content.trim() !== ''
                    && block.paragraph.elements[0].textRun.content !== '\n'
                ) {
                    extractedParagraphs.push(block.paragraph.elements[0].textRun.content.replace(/\n/g, '').trim());
                }
            }
        }
        return {
            content: [
                {
                    type: 'resource',
                    resource: {
                        uri: `https://docs.google.com/document/d/${documentId}`,
                        mimeType: 'application/json',
                        text: JSON.stringify(extractedParagraphs)
                    }
                }
            ]
        };
    } catch (e: any) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error fetching document for inspiration: ${e?.message || e}`
                }
            ],
            isError: true
        };
    }
});

SERVER.registerTool('googleDoc', {
    description: 'Get a Google Doc',
    inputSchema: GOOGLE_INPUT_SCHEMA.shape,
    outputSchema: GOOGLE_OUTPUT_SCHEMA
}, async ({ documentId }) => {
    try {
        const docResponse = await getDoc(documentId);
        return {
            content: [
                {
                    type: 'resource',
                    resource: {
                        uri: `https://docs.google.com/document/d/${documentId}`,
                        mimeType: 'application/json',
                        text: 'Google Doc reference; see structuredContent.document for full data.'
                    }
                }
            ],
            structuredContent: {
                uri: `https://docs.google.com/document/d/${documentId}`,
                document: docResponse.data
            }
        };
    } catch (e: any) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error fetching document: ${e?.message || e}`
                }
            ],
            isError: true
        };
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await SERVER.connect(transport);
}

main().catch(error => {
    console.error('Error starting MCP server:', error);
    process.exit(1);
});