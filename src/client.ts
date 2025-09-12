import z from 'zod';
import fs from 'fs';
import path from 'path';
import { ApifyClient } from 'apify-client';
import { Agent, Runner, setTracingExportApiKey } from '@openai/agents';
import { promptBuilder } from './instructions/promptBuilder.js';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY environment variable not set');
setTracingExportApiKey(process.env.OPENAI_API_KEY!);

interface PostalAddress {
    type?: 'PostalAddress' | string | null;
    streetAddress?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    postalCode?: string | null;
    addressCountry?: string | null;
}

const ZPostalAddress = z.object({
    type: z.string().optional().nullable(),
    streetAddress: z.string().optional().nullable(),
    addressLocality: z.string().optional().nullable(),
    addressRegion: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    addressCountry: z.string().optional().nullable(),
});

interface Job {
    id: string;
    trackingId: string;
    refId: string;
    link: string;
    title: string;
    companyName: string;
    companyLinkedinUrl: string;
    companyLogo: string;
    companyEmployeesCount?: number | undefined;
    location: string;
    postedAt: string;
    salaryInfo: string[];
    salary: string;
    benefits: string[];
    descriptionHtml: string;
    applicantsCount: number | string;
    applyUrl: string;
    descriptionText: string;
    seniorityLevel?: string | undefined;
    employmentType: string;
    jobFunction?: string | undefined;
    industries?: string | undefined;
    inputUrl: string;
    companyAddress?: PostalAddress | undefined;
    companyWebsite?: string | undefined;
    companySlogan?: string | null | undefined;
    companyDescription?: string | undefined;
}

const ZJob = z.object({
    id: z.string(),
    trackingId: z.string(),
    refId: z.string(),
    link: z.string(),
    title: z.string(),
    companyName: z.string(),
    companyLinkedinUrl: z.string(),
    companyLogo: z.string(),
    companyEmployeesCount: z.optional(z.number()),
    location: z.string(),
    postedAt: z.string(),
    salaryInfo: z.array(z.string()),
    salary: z.string(),
    benefits: z.array(z.string()),
    descriptionHtml: z.string(),
    applicantsCount: z.union([z.number(), z.string()]),
    applyUrl: z.string(),
    descriptionText: z.string(),
    seniorityLevel: z.optional(z.string()),
    employmentType: z.string(),
    jobFunction: z.optional(z.string()),
    industries: z.optional(z.string()),
    inputUrl: z.string(),
    companyAddress: z.optional(ZPostalAddress),
    companyWebsite: z.optional(z.string()),
    companySlogan: z.optional(z.string()).nullable(),
    companyDescription: z.optional(z.string()),
});

class ApplicationAssistant {
    private static apify = new ApifyClient({
        token: fs.readFileSync(path.join(process.cwd(), 'secrets/apify_token'), 'utf8').trim()
    });
    private static dataDir = path.join(process.cwd(), 'data');
    private static scrapeUrls = fs.readFileSync(path.join(this.dataDir, 'scrapeUrls.txt'), 'utf8').split('\n').map(l => l.trim());
    private static resumeInspiration: string = fs.readFileSync(path.join(this.dataDir, 'resumeInspiration.txt'), 'utf8').replace(/[\r\n]+/g, '');
    private static applicationsDir = path.join(this.dataDir, 'applications');
    private static jobs: Job[] = [];
    private static runner = new Runner({ workflowName: 'application assistant' });

    private static async scrapeJobs(): Promise<Job[]> {
        const lastScrapePath = path.join(this.dataDir, 'lastScrapeId');
        let lastScrapeId = fs.existsSync(lastScrapePath) ? fs.readFileSync(lastScrapePath, 'utf8').trim() : null;
        if ((lastScrapeId && fs.existsSync(lastScrapePath) && (fs.statSync(lastScrapePath).ctimeMs < (Date.now() - 24 * 60 * 60 * 1000))) || !lastScrapeId) {
            console.log('Last scrape is older than a day, performing a new scrape.');
            await this.apify.actor('curious_coder/linkedin-jobs-scraper').call({
                urls: this.scrapeUrls,
                count: 100
            }).then(scrape => {
                lastScrapeId = scrape.defaultDatasetId;
                fs.writeFileSync(lastScrapePath, lastScrapeId);
            });
        } else console.log('Using last scrape data.');
        const parsedJobs = await z.array(ZJob).safeParseAsync(await this.apify.dataset<Job>(lastScrapeId!).listItems().then(res => res.items));
        if (!parsedJobs.success) throw new Error('Failed to parse jobs from Apify: ' + JSON.stringify(parsedJobs.error));
        return parsedJobs.data;
    }

    private static async filterJobs(): Promise<Job[]> {
        const filterAgent = new Agent<unknown, 'text'>({
            name: 'jobFilterAgent',
            model: 'gpt-5-nano',
            instructions: promptBuilder('filter', [['{{PERSONAL_INFO}}', this.resumeInspiration]]),
            outputType: 'text'
        });
        const scrapedJobs: Job[] = await this.scrapeJobs();
        const filteredJobs: Job[] = [];
        for (const job of scrapedJobs) {
            const run = await this.runner.run<Agent<unknown, 'text'>, 'text'>(filterAgent, `Evaluate the following job vacancy: ${JSON.stringify(job)}`);
            if (run.finalOutput && run.finalOutput.trim().toLowerCase() === 'true') filteredJobs.push(job);
        }
        return filteredJobs;
    }

    private static async writeApplications(): Promise<string[]> {
        const evaluator = new Agent<string>({
            name: 'responseEvaluator',
            instructions: promptBuilder('evaluator'),
            model: 'gpt-5-nano',
            outputType: 'text',
            handoffDescription: 'Evaluate the quality of a job application letter.'
        });
        const maxRetries = 5;

        const runWriterForJobs = async (jobsSubset: Job[]): Promise<string[]> => {
            const writer = new Agent<string>({
                name: 'writer',
                model: 'gpt-5',
                outputType: 'text',
                instructions: promptBuilder('writer', [
                    ['{{PERSONAL_INFO}}', this.resumeInspiration],
                    ['{{JOBS_SUBSET}}', JSON.stringify(jobsSubset)],
                    ['{{JOBS_SUBSET_LENGTH}}', String(jobsSubset.length)]
                ]),
                tools: [
                    evaluator.asTool({
                        toolName: '#evaluation',
                        toolDescription: 'Evaluate a single job application letter. Returns "good" or "bad".',
                        customOutputExtractor: (output: unknown) => {
                            if (typeof output === 'string') {
                                const trimmed = output.trim().toLowerCase();
                                if (trimmed === 'good' || trimmed === 'bad') return trimmed;
                            }
                            throw new Error('Evaluation output must be exactly "good" or "bad"');
                        }
                    })
                ]
            });

            let attempt = 0;
            while (attempt <= maxRetries) {
                try {
                    const finalOutput = (await this.runner.run<Agent<string>, { job: Job }>(writer, 'Write job application letters.')).finalOutput;
                    if (!finalOutput) throw new Error('Writer did not return a final output.');
                    const parsed = JSON.parse(finalOutput);
                    if (Array.isArray(parsed) && parsed.length === jobsSubset.length && parsed.every(v => typeof v === 'string')) return parsed;
                    throw new Error('Writer did not return valid final output.');
                } catch (err: any) {
                    const message: string = err?.message || String(err);
                    const isTooLarge = err?.code === 'rate_limit_exceeded' && /Request too large/i.test(message);
                    const isRateLimited = err?.code === 'rate_limit_exceeded';

                    if (isTooLarge) {
                        if (jobsSubset.length === 1) throw err;
                        const mid = Math.floor(jobsSubset.length / 2);
                        console.warn(`Request too large. Splitting ${jobsSubset.length} jobs into ${mid} + ${jobsSubset.length - mid}.`);
                        return [
                            ...(await runWriterForJobs(jobsSubset.slice(0, mid))),
                            ...(await runWriterForJobs(jobsSubset.slice(mid)))
                        ];
                    }

                    if (isRateLimited) {
                        // Parse suggested wait time
                        const msMatch = message.match(/try again in (\d{1,4})ms/i);
                        const sMatch = message.match(/try again in (\d+)(?:\.(\d+))?s/i);
                        let wait: number | undefined;
                        if (msMatch) wait = parseInt(msMatch[1], 10);
                        else if (sMatch) wait = parseInt(sMatch[1], 10) * 1000 + parseInt(((sMatch[2] || '') + '000').slice(0, 3), 10);
                        else wait = 1000 + attempt * 500;
                        if (attempt < maxRetries) {
                            attempt++;
                            console.warn(`Rate limited (attempt ${attempt}/${maxRetries}). Waiting ${wait}ms.`);
                            await new Promise(r => setTimeout(r, wait));
                            continue;
                        }
                    }
                    throw err;
                }
            }
            throw new Error('Exceeded max retries for writer.');
        };

        const applications = await runWriterForJobs(this.jobs);
        return applications;
    }

    public static async start() {
        const cwd = process.cwd();
        const secretsDir = path.join(cwd, 'secrets');
        const required: Array<[string, string]> = [
            [path.join(secretsDir, 'apify_token'), `Apify token file does not exist: ${secretsDir}/apify_token`],
            [path.join(cwd, 'data'), 'Data directory does not exist'],
            [secretsDir, 'Secrets directory does not exist'],
            [this.applicationsDir, `Applications directory does not exist: ${this.applicationsDir}`],
            [path.join(this.dataDir, 'resumeInspiration.txt'), `Resume inspiration file does not exist: ${path.join(this.dataDir, 'resumeInspiration.txt')}`],
            [path.join(this.dataDir, 'scrapeUrls.txt'), `Scrape URLs file does not exist: ${path.join(this.dataDir, 'scrapeUrls.txt')}`]
        ];
        for (const [p, msg] of required) if (!fs.existsSync(p)) throw new Error(msg);
        this.jobs = await this.filterJobs();
        console.log('These jobs match best:\n', this.jobs.map(job => '#' + job.id + ' ' + job.title + ' at ' + job.companyName).join('\n'));
        const applications = await this.writeApplications();
        for (const application of applications) {
            const jobId = this.jobs[applications.indexOf(application)].id;
            const filename = path.join(this.applicationsDir, `${jobId}.html`);
            fs.writeFileSync(filename, application);
            console.log('Wrote application letter to', filename);
        }
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});