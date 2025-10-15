import OpenAI from "openai";
import path from 'path';
import fs from 'fs';
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';
import { AgentTypeEnum } from "./enums.js";
import { MongoClient } from "mongodb";
import { NoMongoDBConnectionStringError } from "./errors.js";

export function normalizeWhitespace(input: string) {
    return input
        .replace(/\r/g, '')
        .replace(/ {2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
}

const instructions = await (async () => {
    if (!process.env.MONGODB_CONNECTION_STRING) throw new NoMongoDBConnectionStringError();
    const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING);
    try {
        return Object.fromEntries(await Promise.all(
            [AgentTypeEnum.Filter, AgentTypeEnum.Writer].map(async t => {
                const doc = await client.db('applicationAgentDB').collection('prompts').findOne<MongoDBAgentPromptDocument>({ agentType: t });
                if (!doc?.prompt?.trim()) throw new Error(`Missing prompt for agent type: ${t}`);
                return [t, doc.prompt];
            })
        ));
    } finally {
        await client.close();
    }
})();

export function promptBuilder(agentType: AgentTypeEnum, additionalPlaceholders: Array<[string, string]> = []): string {
    const readApps = (kind: 'good' | 'bad') => {
        const dir = path.join(process.cwd(), 'data', 'applications', kind + 'Responses');
        if (!fs.existsSync(dir)) throw new Error(`Responses directory does not exist: ${dir}`);
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.html'))
            .map(f => normalizeWhitespace(fs.readFileSync(path.join(dir, f), 'utf8')))
            .filter(Boolean);
    };
    const reservedPlaceholders = {
        GOOD_APPLICATIONS: '{{GOOD_APPLICATIONS}}',
        BAD_APPLICATIONS: '{{BAD_APPLICATIONS}}',
        RECOMMENDED_PROMPT_PREFIX: '{{RECOMMENDED_PROMPT_PREFIX}}'
    };
    if (additionalPlaceholders.length) {
        if (additionalPlaceholders.some(([ph]) => !/^{{.*}}$/.test(ph))) throw new Error('All additional placeholders must be in the format {{PLACEHOLDER}}');
        if (new Set(additionalPlaceholders.map(p => p[0])).size !== additionalPlaceholders.length) throw new Error('All additional placeholders must be unique');
        const reservedVals = Object.values(reservedPlaceholders);
        if (additionalPlaceholders.some(([ph]) => reservedVals.includes(ph))) throw new Error(`Additional placeholders cannot use reserved placeholder names: ${reservedVals.join(', ')}`);
        if (additionalPlaceholders.some(([, v]) => !v.trim())) throw new Error('All additional placeholder values must be non-empty strings');
        additionalPlaceholders = additionalPlaceholders.map(([ph, v]) => [ph, normalizeWhitespace(v)]);
    }
    return [
        [reservedPlaceholders.GOOD_APPLICATIONS, readApps('good').join('\n')],
        [reservedPlaceholders.BAD_APPLICATIONS, readApps('bad').join('\n')],
        [reservedPlaceholders.RECOMMENDED_PROMPT_PREFIX, RECOMMENDED_PROMPT_PREFIX],
        ...additionalPlaceholders
    ].reduce((prev, [ph, val]) => prev.replaceAll(ph, val), instructions[agentType]);
}

const DEFAULT_RETRYABLE_STATUS = (status: number | null) => status === 429 || status === null || (status >= 500 && status < 600);

function extractSuggestedDelayMs(err: unknown): number | null {
    if (err && typeof err === 'object') {
        const anyErr: any = err as any;
        const headers = anyErr?.response?.headers;
        if (headers) {
            console.log('Error headers:', headers);
            const retryAfter = headers['retry-after'] || headers['Retry-After'];
            if (retryAfter) {
                const asNumber = Number(retryAfter);
                if (!Number.isNaN(asNumber)) {
                    return asNumber * 1000; //if header.retry-after is in seconds, return milliseconds
                } else {
                    const dateMs = Date.parse(retryAfter);
                    if (!Number.isNaN(dateMs)) {
                        const delta = dateMs - Date.now();
                        if (delta > 0) return delta; //if date is in the future, return milliseconds until that date
                    }
                }
            }
        }
        if (typeof anyErr.message === 'string') {
            const retrymatch = anyErr.message.match(/try again in (?:(\d{1,4})ms|(\d+)(?:\.(\d+))?s)/i);
            if (retrymatch) {
                const [, ms, s] = retrymatch;
                if (ms) return Number(ms);
                if (s) return Number(s) * 1000;
            }
        }
    }
    return null;
}

export async function safeCall<T>(context: string, fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const {
        retries = 5,
        baseDelayMs = 600,
        maxDelayMs = 8000,
        jitterRatio = 0.4,
        retryOn = ({ status }) => DEFAULT_RETRYABLE_STATUS(status),
        onRequestTooLarge
    } = opts;
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (err) {
            let status: any, message: string, type: string | undefined;
            if (err instanceof OpenAI.APIError) {
                status = err.status ?? null;
                type = err.type;
                message = err.message;
            } else {
                status = null;
                type = 'unknown';
                message = (err as any)?.message ?? String(err);
            }
            if (message && /request too large/i.test(message)) {
                if (onRequestTooLarge) {
                    console.warn(`[safeCall] ${context} request too large; invoking onRequestTooLarge handler.`);
                    return await onRequestTooLarge();
                }
                console.error(`[safeCall] ${context} request too large but no onRequestTooLarge handler provided.`);
                return Promise.reject(err);
            }
            if (!(attempt < retries && retryOn({ status, error: err, attempt }))) {
                console.error(`[safeCall] ${context} failed (final):`, { status, type, message });
                return Promise.reject(err);
            }
            let delayMs: number | null = extractSuggestedDelayMs(err);
            let reason = 'server-suggested';
            if (delayMs === null) {
                console.warn('[safeCall] could not extract suggested delay from error:', err, 'falling back to exponential backoff');
                reason = status === 429 ? 'rate-limit' : (status && status >= 500 ? 'server-error' : 'network/unknown');
                delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
            }
            const jitterRange = delayMs * jitterRatio;
            delayMs += Math.max(0, Math.round((Math.random() * jitterRange * 2) - jitterRange));
            console.warn(`[safeCall] ${context} failed (attempt ${attempt + 1} of ${retries}, ${reason}), retrying in ${delayMs}ms:`, { status, type, message });
            await sleep(delayMs);
            attempt++;
        }
    }
}

export const readJSON = <T>(p: string, options: { encoding: BufferEncoding, flag?: string | undefined } | BufferEncoding = 'utf8') => JSON.parse(fs.readFileSync(p, options)) as T;

export function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }