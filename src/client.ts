import z from 'zod';
import fs from 'fs';
import path from 'path';
import { ApifyClient } from 'apify-client';
import { Agent, handoff, RunContext, Runner, setTracingExportApiKey, tool } from '@openai/agents';
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';
import { ZodString } from 'zod/v4';

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
    companyEmployeesCount: number;
    location: string;
    postedAt: string;
    salaryInfo: string[];
    salary: string;
    benefits: string[];
    descriptionHtml: string;
    applicantsCount: number | string;
    applyUrl: string;
    descriptionText: string;
    seniorityLevel: string;
    employmentType: string;
    jobFunction: string;
    industries: string;
    inputUrl: string;
    companyAddress: PostalAddress;
    companyWebsite: string;
    companySlogan?: string | null | undefined;
    companyDescription: string;
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
    companyEmployeesCount: z.number(),
    location: z.string(),
    postedAt: z.string(),
    salaryInfo: z.array(z.string()),
    salary: z.string(),
    benefits: z.array(z.string()),
    descriptionHtml: z.string(),
    applicantsCount: z.union([z.number(), z.string()]),
    applyUrl: z.string(),
    descriptionText: z.string(),
    seniorityLevel: z.string(),
    employmentType: z.string(),
    jobFunction: z.string(),
    industries: z.string(),
    inputUrl: z.string(),
    companyAddress: ZPostalAddress,
    companyWebsite: z.string(),
    companySlogan: z.string().optional().nullable(),
    companyDescription: z.string(),
});

class ApplicationAssistant {
    private static apify = new ApifyClient({
        token: fs.readFileSync(path.join(process.cwd(), 'secrets/apify_token'), 'utf8').trim()
    });
    private static jobs: Job[] = [];
    private static resumeInspiration: string = fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.txt'), 'utf8').replace(/[\r\n]+/g, '');
    private static goodApplications: string[] = [];
    private static badApplications: string[] = [];
    private static applicationsDir = path.join(process.cwd(), 'data/applications');
    private static dataDir = path.join(process.cwd(), 'data');
    private static runner = new Runner({ workflowName: 'application assistant' });
    private static personalInfoTool = tool({ //TODO #2
        name: '#personalInformation',
        description: 'Fetch personal information about someone from a file',
        parameters: z.object({}),
        execute: () => ApplicationAssistant.resumeInspiration
    });
    private static readResponseFiles(dir: string): string[] {
        return fs.readdirSync(dir)
            .map(f => path.join(dir, f))
            .filter(p => fs.statSync(p).isFile())
            .map(p => fs.readFileSync(p, 'utf8'));
    }

    private static async scrapeJobs(): Promise<Job[]> {
        const lastScrapePath = path.join(this.dataDir, 'lastScrapeId');
        const lastScrapeId = fs.existsSync(lastScrapePath) ? fs.readFileSync(lastScrapePath, 'utf8').trim() : null;
        const rawScrapeData = (lastScrapeId && fs.statSync(lastScrapePath).birthtimeMs > (Date.now() - 24 * 60 * 60 * 1000)) ?
            await this.apify.dataset<Job>(lastScrapeId).listItems().then(res => res.items)
            : await this.apify.actor('curious_coder/linkedin-jobs-scraper').call({
                urls: ['https://www.linkedin.com/jobs/search?keywords=Web%20Development&location=Hamburg&geoId=106430557&f_C=41629%2C11010661%2C162679%2C11146938%2C234280&distance=25&f_E=1%2C2&f_PP=106430557&f_TPR=&position=1&pageNum=0'],
                count: 100
            }).then(scrape => {
                fs.writeFileSync(lastScrapePath, scrape.defaultDatasetId);
                return this.apify.dataset<Job>(scrape.defaultDatasetId).listItems();
            }).then(res => res.items);
        const parsedJobs = await z.array(ZJob).safeParseAsync(rawScrapeData);
        if (!parsedJobs.success) throw new Error('Failed to parse jobs from Apify: ' + JSON.stringify(parsedJobs.error));
        return parsedJobs.data;
    }

    private static async filterJobs(): Promise<Job[]> {
        const filterAgent = new Agent<unknown, 'text'>({
            name: 'jobFilterAgent',
            model: 'gpt-5-nano',
            instructions: `You are an expert in categorizing job vacancies. Your task is to evaluate whether a given job vacancy fits to your personal information. Respond with the word 'true', if the job vacancy fits to your personal information, otherwise respond with the word 'false'.`,
            outputType: 'text'
        });
        const personal = fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.txt'), 'utf8').replace(/[\r\n]+/g, '');
        const scrapedJobs: Job[] = await this.scrapeJobs();
        const filteredJobs: Job[] = [];
        for (const job of scrapedJobs) {
            const run = await this.runner.run<Agent<unknown, 'text'>, 'text'>(filterAgent, `This is personal information about me: ${personal} Evaluate the following job vacancy: ${job}`);
            if (run.finalOutput && run.finalOutput.trim().toLowerCase() === 'true') filteredJobs.push(job);
        }
        return filteredJobs;
    }

    private static writeApplications(): Promise<string[]> {
        return Promise.all(Array.from(this.jobs, job => new Promise<string>(async (resolve, reject) => {
            const evaluator = new Agent<string>({
                name: 'responseEvaluator',
                instructions: `${RECOMMENDED_PROMPT_PREFIX}
                You are an evaluator of job application letters. Evaluate the quality of a job application letter by comparing it to the good and bad examples of the #goodExamples and #badExamples tools. Return exactly one word: "good" or "bad".`,
                model: 'gpt-5-nano',
                outputType: 'text',
                handoffDescription: 'Evaluate the quality of a job application letter.',
                tools: [tool({
                    name: '#goodExamples',
                    description: 'Fetch good examples of job application letters',
                    parameters: z.object({}),
                    execute: () => this.goodApplications
                }), tool({
                    name: '#badExamples',
                    description: 'Fetch bad examples of job application letters',
                    parameters: z.object({}),
                    execute: () => this.badApplications
                })]
            });
            const agent = new Agent<string>({
                name: 'writerAgent',
                instructions: 'You are a writer of job application letters. Fetch a job vacancy with the #jobVacancy tool. Fetch personal information with the #personalInformation tool and use the information to write a job application letter for the job vacancy in HTML with inline CSS. Evaluate the quality of your job application letter with the #evaluation tool. Rewrite the job application letter as long as the #evaluation tool returns "bad". Do not include the result of the evaluation in the output. If the #evaluation tool returns "good", output the job application letter as a valid HTML document with doctype. No line breaks within the HTML strings, escape quotation marks within HTML.',
                model: 'gpt-5',
                tools: [
                    this.personalInfoTool,
                    evaluator.asTool({
                        toolName: '#evaluation',
                        toolDescription: 'Evaluate the quality of a job application letter.',
                        customOutputExtractor: (output: unknown) => {
                            if (typeof output === 'string') {
                                const trimmed = output.trim().toLowerCase();
                                if (trimmed === 'good' || trimmed === 'bad') return trimmed;
                            }
                            throw new Error('Evaluation output must be exactly "good" or "bad".');
                        }
                    }),
                    tool<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, unknown, Job>({
                        name: '#jobVacancy',
                        description: 'Fetch a job vacancy.',
                        parameters: z.object({}),
                        execute: () => job
                    })
                ]
            });
            const maxRetries = 5;
            let attempts = 0;

            const attemptRun = () => {
                this.runner.run<Agent<string>, { job: Job }>(agent, 'Write a job application letter.').then(result => {
                    if (result.finalOutput) {
                        console.log('Wrote application for job: #' + job.id);
                        fs.writeFileSync(path.join(this.applicationsDir, `${job.id}.html`), result.finalOutput, 'utf8');
                        resolve(result.finalOutput);
                    } else {
                        reject(new Error('No final output produced.'));
                    }
                }).catch(err => {
                    const msg: string = (err && err.message) ? err.message : String(err);
                    const msMatch = msg.match(/Please try again in (\d{1,3})ms/);
                    const sMatch = msg.match(/Please try again in (\d+)(?:\.(\d+))?s/);
                    let wait: number | null = null;

                    if (msMatch) {
                        wait = parseInt(msMatch[1], 10);
                    } else if (sMatch) {
                        const whole = parseInt(sMatch[1], 10);
                        const fracRaw = sMatch[2] || '';
                        // Normalize fraction to milliseconds (take up to 3 digits)
                        const fracMs = parseInt((fracRaw + '000').slice(0, 3), 10);
                        wait = whole * 1000 + fracMs;
                    }

                    if (wait !== null && attempts < maxRetries) {
                        attempts++;
                        console.warn(`Filter retry ${attempts}/${maxRetries} after ${wait}ms due to rate limit.`);
                        setTimeout(attemptRun, wait);
                    } else {
                        reject(err);
                    }
                });
            };

            attemptRun();
        })));
    }

    public static async start() {
        const cwd = process.cwd();
        const secretsDir = path.join(cwd, 'secrets');
        const goodResDir = path.join(this.applicationsDir, 'goodResponses');
        const badResDir = path.join(this.applicationsDir, 'badResponses');
        const required: Array<[string, string]> = [
            [path.join(secretsDir, 'apify_token'), `Apify token file does not exist: ${secretsDir}/apify_token`],
            [path.join(cwd, 'data'), 'Data directory does not exist'],
            [secretsDir, 'Secrets directory does not exist'],
            [this.applicationsDir, `Applications directory does not exist: ${this.applicationsDir}`],
            [badResDir, `Bad responses directory does not exist: ${badResDir}`],
            [goodResDir, `Good responses directory does not exist: ${goodResDir}`]
        ];
        for (const [p, msg] of required) if (!fs.existsSync(p)) throw new Error(msg);

        this.goodApplications.push(...this.readResponseFiles(goodResDir));
        this.badApplications.push(...this.readResponseFiles(badResDir));
        this.jobs = await this.filterJobs();
        console.log('These jobs match best:\n', this.jobs.map(job => '#' + job.id + ' ' + job.title + ' at ' + job.companyName).join('\n'));
        await this.writeApplications();
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});