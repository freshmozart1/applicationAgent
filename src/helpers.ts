import OpenAI from "openai";
import path from 'path';
import fs from 'fs';
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';

export function normalizeWhitespace(input: string) {
    return input
        .replace(/\r/g, '')
        .replace(/ {2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
}
export function promptBuilder(agentType: 'filter' | 'writer' | 'evaluator', additionalPlaceholders: Array<[string, string]> = []): string {
    const readApps = (kind: 'good' | 'bad') => {
        const dir = path.join(process.cwd(), 'data', 'applications', kind + 'Responses');
        if (!fs.existsSync(dir)) throw new Error(`Responses directory does not exist: ${dir}`);
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.html'))
            .map(f => normalizeWhitespace(fs.readFileSync(path.join(dir, f), 'utf8')))
            .filter(Boolean);
    };
    const base = path.join(process.cwd(), 'instructions');
    const fileMap = { filter: 'filter.txt', writer: 'writer.txt', evaluator: 'evaluator.txt' } as const;
    if (!fs.existsSync(base)) throw new Error(`Instructions directory does not exist: ${base}`);
    const instructions: Record<keyof typeof fileMap, string> = { filter: '', writer: '', evaluator: '' };
    (Object.keys(fileMap) as Array<keyof typeof fileMap>).forEach(k => {
        const p = path.join(base, fileMap[k]);
        if (!fs.existsSync(p)) throw new Error(`${k[0].toUpperCase() + k.slice(1)} instructions file does not exist: ${p}`);
        const content = normalizeWhitespace(fs.readFileSync(p, 'utf8'));
        if (!content) throw new Error(`${k[0].toUpperCase() + k.slice(1)} instructions file is empty: ${p}`);
        instructions[k] = content;
    });
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
        jitterRatio = 0.2,
        retryOn = ({ status }) => DEFAULT_RETRYABLE_STATUS(status),
        onRetry,
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
                    console.warn(`[safeCall] ${context} request too large; invoking split handler.`);
                    return await onRequestTooLarge();
                }
                console.error(`[safeCall] ${context} request too large but no split handler provided.`);
                throw err;
            }
            if (!(attempt < retries && retryOn({ status, error: err, attempt }))) {
                console.error(`[safeCall] ${context} failed (final):`, { status, type, message });
                throw err;
            }
            let delayMs: number | null = extractSuggestedDelayMs(err);
            let reason = 'server-suggested';
            if (delayMs === null) {
                console.warn('[safeCall] could not extract suggested delay from error:', err, 'falling back to exponential backoff');
                reason = status === 429 ? 'rate-limit' : (status && status >= 500 ? 'server-error' : 'network/unknown');
                delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
            }
            const jitterRange = delayMs * jitterRatio;
            delayMs = Math.max(0, Math.round(delayMs + (Math.random() * jitterRange * 2) - jitterRange));
            onRetry?.({ attempt: attempt + 1, delayMs, reason });
            console.warn(`[safeCall] ${context} failed (attempt ${attempt + 1} of ${retries}, ${reason}), retrying in ${delayMs}ms:`, { status, type, message });
            await new Promise(res => setTimeout(res, delayMs));
            attempt++;
        }
    }
}