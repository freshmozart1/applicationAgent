import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs/promises';
import path from 'node:path';

const SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];

export async function googleAuth() {
    const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'secrets/credentials.json'), 'utf8'));
    const credentials = raw.type ? raw : (raw.installed || raw.web);
    if (!credentials) throw new Error('Invalid credentials.json: expected a service account');
    if (credentials.type === 'service_account') return new GoogleAuth({ credentials, scopes: SCOPES });
    else throw new Error(`Unsupported credentials type: ${credentials.type}. Expected 'service_account'.`);
}