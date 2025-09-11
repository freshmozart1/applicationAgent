import path from 'path';
import fs from 'fs';
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';

export function promptBuilder(agentType: 'filter' | 'writer' | 'evaluator', additionalPlaceholders: Array<[string, string]> = []): string {
    const norm = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n\n').trim();
    const readApps = (kind: 'good' | 'bad') => {
        const dir = path.join(process.cwd(), 'data', 'applications', kind + 'Responses');
        if (!fs.existsSync(dir)) throw new Error(`Responses directory does not exist: ${dir}`);
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.html'))
            .map(f => norm(fs.readFileSync(path.join(dir, f), 'utf8')))
            .filter(Boolean);
    };
    const base = path.join(process.cwd(), 'instructions');
    const fileMap = { filter: 'filter.txt', writer: 'writer.txt', evaluator: 'evaluator.txt' } as const;
    if (!fs.existsSync(base)) throw new Error(`Instructions directory does not exist: ${base}`);
    const instructions: Record<keyof typeof fileMap, string> = { filter: '', writer: '', evaluator: '' };
    (Object.keys(fileMap) as Array<keyof typeof fileMap>).forEach(k => {
        const p = path.join(base, fileMap[k]);
        if (!fs.existsSync(p)) throw new Error(`${k[0].toUpperCase() + k.slice(1)} instructions file does not exist: ${p}`);
        const content = norm(fs.readFileSync(p, 'utf8'));
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
        additionalPlaceholders = additionalPlaceholders.map(([ph, v]) => [ph, norm(v)]);
    }
    return [
        [reservedPlaceholders.GOOD_APPLICATIONS, readApps('good').join('\n')],
        [reservedPlaceholders.BAD_APPLICATIONS, readApps('bad').join('\n')],
        [reservedPlaceholders.RECOMMENDED_PROMPT_PREFIX, RECOMMENDED_PROMPT_PREFIX],
        ...additionalPlaceholders
    ].reduce((prev, [ph, val]) => prev.replaceAll(ph, val), instructions[agentType]);
}
