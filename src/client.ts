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
    private static jobSchema: string = `{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Job",
    "type": "object",
    "additionalProperties": false,
    "properties": {
        "id": { "type": "string" },
        "trackingId": { "type": "string" },
        "refId": { "type": "string" },
        "link": { "type": "string" },
        "title": { "type": "string" },
        "companyName": { "type": "string" },
        "companyLinkedinUrl": { "type": "string" },
        "companyLogo": { "type": "string" },
        "companyEmployeesCount": { "type": "number" },
        "location": { "type": "string" },
        "postedAt": { "type": "string" },
        "salaryInfo": {
            "type": "array",
            "items": { "type": "string" }
        },
        "salary": { "type": "string" },
        "benefits": {
            "type": "array",
            "items": { "type": "string" }
        },
        "descriptionHtml": { "type": "string" },
        "applicantsCount": {
            "oneOf": [
                { "type": "number" },
                { "type": "string" }
            ]
        },
        "applyUrl": { "type": "string" },
        "descriptionText": { "type": "string" },
        "seniorityLevel": { "type": "string" },
        "employmentType": { "type": "string" },
        "jobFunction": { "type": "string" },
        "industries": { "type": "string" },
        "inputUrl": { "type": "string" },
        "companyAddress": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "type": { "type": ["string", "null"] },
                "streetAddress": { "type": ["string", "null"] },
                "addressLocality": { "type": ["string", "null"] },
                "addressRegion": { "type": ["string", "null"] },
                "postalCode": { "type": ["string", "null"] },
                "addressCountry": { "type": ["string", "null"] }
            },
            "required": []
        },
        "companyWebsite": { "type": "string" },
        "companySlogan": { "type": ["string", "null"] },
        "companyDescription": { "type": "string" }
    },
    "required": [
        "id",
        "trackingId",
        "refId",
        "link",
        "title",
        "companyName",
        "companyLinkedinUrl",
        "companyLogo",
        "companyEmployeesCount",
        "location",
        "postedAt",
        "salaryInfo",
        "salary",
        "benefits",
        "descriptionHtml",
        "applicantsCount",
        "applyUrl",
        "descriptionText",
        "seniorityLevel",
        "employmentType",
        "jobFunction",
        "industries",
        "inputUrl",
        "companyAddress",
        "companyWebsite",
        "companyDescription"
    ]}`;
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

    //This method returns a rejected promise if less than 5 Jobs were filtered
    private static async filterJobs(): Promise<Job[]> {
        const chunks: Promise<Job>[] = [],
            lastRunPath = path.join(this.dataDir, 'last_run.txt'),
            lastRunId = fs.existsSync(lastRunPath) ? fs.readFileSync(lastRunPath, 'utf8').trim() : null;
        console.log('Last run ID:', lastRunId);
        let raw;
        if (lastRunId) {
            raw = await this.apify.dataset<Job>(lastRunId).listItems().then(res => res.items);
        } else {
            raw = await this.apify.actor('curious_coder/linkedin-jobs-scraper').call({
                urls: ['https://www.linkedin.com/jobs/search?keywords=Web%20Development&location=Hamburg&geoId=106430557&f_C=41629%2C11010661%2C162679%2C11146938%2C234280&distance=25&f_E=1%2C2&f_PP=106430557&f_TPR=&position=1&pageNum=0'],
                count: 100
            }).then(run => {
                console.log('LinkedIn scraper actor finished with run ID:', run.id);
                fs.writeFileSync(lastRunPath, run.defaultDatasetId);
                return this.apify.dataset<Job>(run.defaultDatasetId).listItems();
            })
                .then(res => res.items);
        }
        const parsed = await z.array(ZJob).safeParseAsync(raw);
        if (!parsed.success) {
            console.error('Failed to parse jobs from Apify:', parsed.error);
            throw new Error('Failed to parse jobs from Apify: ' + JSON.stringify(parsed.error));
        }
        console.log('Fetched', parsed.success ? parsed.data.length : 0, 'jobs from Apify');
        let chunksCounter = 0, size: number, divider = 5;
        if (parsed.data.length % divider === 0) {
            size = parsed.data.length / divider;
        } else {
            size = Math.ceil(parsed.data.length / divider);
        }
        while (chunksCounter < parsed.data.length) {
            chunks.push(new Promise<Job>((resolve, reject) => {
                const chunk: Job[] = parsed.data.slice(chunksCounter, chunksCounter + size);
                const agent = new Agent<unknown, typeof ZJob>({
                    name: 'jobVacanciesAgent',
                    instructions: 'You are someone who searches for a job vacancy in the list of job vacancies provided by the #jobVacancies tool. Fetch personal information about yourself with the #personalInformation tool. Use this information to select the job vacancy from the list of job vacancies that best matches your personal information. The list of job vacancies is an array of JobInfo objects. JobInfo objects have this JSON schema: ' + this.jobSchema + ' Return the job vacancy as a JSON object that looks like this: ' + this.jobSchema + '. Do not include any additional text or explanations. Do not modify the keys and values of the JobInfo objects.',
                    model: 'gpt-5-nano',
                    tools: [this.personalInfoTool, tool<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, unknown, Job[]>({
                        name: '#jobVacancies',
                        description: 'Fetch the list of job vacancies',
                        parameters: z.object({}),
                        execute: () => chunk,

                    })],
                    outputType: ZJob
                });
                this.runner.run<Agent<unknown, typeof ZJob>>(agent, 'Find a matching job.').then(result => {
                    if (result.finalOutput) resolve(result.finalOutput);
                    reject(new Error('No matching job found.'));
                });
                chunksCounter += size;
            }));
        }
        return Promise.all(chunks);
    }

    private static writeApplications(): Promise<string[]> {
        return Promise.all(Array.from(this.jobs, job => new Promise<string>((resolve, reject) => {
            const evaluator = new Agent<string>({
                name: 'responseEvaluator',
                instructions: `${RECOMMENDED_PROMPT_PREFIX}
                You are an evaluator of job application letters. Evaluate the quality of a job application letter by comparing it to the good and bad examples of the #goodExamples and #badExamples tools.Return exactly one word: "good" or "bad".`,
                model: 'gpt-5-nano',
                outputType: 'text',
                handoffDescription: 'Evaluate the quality of a job application letter.',
                tools: [tool({
                    name: '#goodExamples',
                    description: 'Fetch good examples of job application letters',
                    parameters: z.object({}),
                    execute: () => ApplicationAssistant.goodApplications
                }), tool({
                    name: '#badExamples',
                    description: 'Fetch bad examples of job application letters',
                    parameters: z.object({}),
                    execute: () => ApplicationAssistant.badApplications
                })]
            });
            const agent = new Agent<unknown, 'text'>({
                name: 'writerAgent',
                instructions: 'You are a writer of job application letters. Fetch personal information with the #personalInformation tool. Evaluate the quality of your job application letter. Only output valid HTML with doctype. No line breaks within the HTML strings, escape quotation marks within HTML.',
                model: 'gpt-5',
                tools: [this.personalInfoTool],
                handoffs: [handoff(evaluator)]
            });
            this.runner.run<Agent<unknown, 'text'>, undefined>(agent, 'Write a job application letter for this job in HTML (inline CSS allowed, no external resources): ' + JSON.stringify(job) + '.').then((result) => {
                if (result.finalOutput) {
                    console.log('Wrote application for job', job.id);
                    fs.writeFileSync(path.join(this.applicationsDir, `${job.id}.html`), result.finalOutput || '', 'utf8');
                    resolve(result.finalOutput);
                }
            }).catch(err => reject(err));
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
        //TODO #4 await this.writeApplications();
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});