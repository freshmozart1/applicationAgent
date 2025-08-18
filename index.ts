import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { docs_v1, google } from 'googleapis';
import z from 'zod';

const SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const APP = express();
const SERVER = new McpServer({
    name: 'applicationAgentMCPServer',
    version: '1.0.0'
});
const TRANSPORTS: { [sessionId: string]: StreamableHTTPServerTransport } = {};

let cachedDocsClient: docs_v1.Docs;

async function handleSessionRequest(req: Request, res: Response) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !TRANSPORTS[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
    }
    await TRANSPORTS[sessionId].handleRequest(req, res);
}

async function authorize() {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    const raw = JSON.parse(content);
    const credentials = raw.type ? raw : (raw.installed || raw.web);
    if (!credentials) {
        throw new Error('Invalid credentials.json: expected either a service_account or authorized_user JSON, or an installed/web block.');
    }
    // Service Account: bevorzugt über GoogleAuth + SCOPES
    if (credentials.type === 'service_account') {
        return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    }
    // Authorized User: benötigt refresh_token im JSON
    if (credentials.type === 'authorized_user') {
        if (!credentials.refresh_token) {
            throw new Error('authorized_user credentials require a refresh_token in credentials.json.');
        }
        return google.auth.fromJSON(credentials);
    }
    // Installierte/Web-Clientdaten ohne Token sind nicht ausreichend ohne interaktiven Flow
    if (credentials.client_id && credentials.client_secret) {
        throw new Error('OAuth client (web/installed) credentials found but no tokens present. Provide authorized_user with refresh_token or a service_account.');
    }
    // Fallback: versuche fromJSON (externe Accounts o.ä.)
    return google.auth.fromJSON(credentials);
}

async function getDoc(documentId: string) {
    const auth = await authorize();
    if (!cachedDocsClient) cachedDocsClient = google.docs({ version: 'v1', auth: auth as any });
    return await cachedDocsClient.documents.get({ documentId });
}

SERVER.registerTool('google_doc', {
    description: 'Get a Google Doc',
    inputSchema: {
        documentId: z.string()
    },
    outputSchema: {
        uri: z.string().url(),
        document: z.object({
            title: z.string(),
            body: z.object({
                content: z.array(z.any())
            }),
            documentStyle: z.any().optional(),
            namedStyles: z.any(),
            suggestionsViewMode: z.string(),
            documentId: z.string()
        })
    }
}, async ({ documentId }) => {
    try {
        const docResponse = await getDoc(documentId);
        // Liefere maschinenlesbare Daten ohne Stringify über structuredContent
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

APP.use(express.json());

APP.post('/mcp', async (req: Request, res: Response) => {
    const headerSessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined = headerSessionId
        ? TRANSPORTS[headerSessionId]
        : undefined;
    // Stelle sicher, dass JSON-Antworten aktiviert sind (auch bei bestehenden Sessions)
    if (transport) {
        (transport as any)._enableJsonResponse = true;
    }

    // Wenn keine bekannte Session vorhanden ist: Neue Session erstellen (kompatibel zu Clients ohne initialize)
    if (!transport) {
        const newTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            // enableJsonResponse: true,
            onsessioninitialized: (sessionId) => {
                TRANSPORTS[sessionId] = newTransport;
            }
        });
        newTransport.onclose = () => {
            if (newTransport.sessionId) delete TRANSPORTS[newTransport.sessionId];
        };
        await SERVER.connect(newTransport);
        // Self-initialize: adopt client-provided session ID if present, otherwise generate one
        const adoptedSessionId = headerSessionId ?? randomUUID();
        (newTransport as any).sessionId = adoptedSessionId;
        (newTransport as any)._initialized = true;
        TRANSPORTS[adoptedSessionId] = newTransport;
        transport = newTransport;
    }
    await transport.handleRequest(req, res, req.body);
});

APP.get('/mcp', handleSessionRequest);

APP.delete('/mcp', handleSessionRequest);

APP.listen(3000, (error) => {
    if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
    console.log(`MCP Stateless Streamable HTTP Server listening on port 3000`);
});