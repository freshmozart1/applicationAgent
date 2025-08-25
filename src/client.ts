import z from 'zod';
import fs from 'fs';
import path from 'path';
import { ApifyClient } from 'apify-client';
import { Agent, Runner, setTracingExportApiKey, tool } from '@openai/agents';

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
    private static applicationSchema: string = `{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Job Applications",
    "type": "object",
    "additionalProperties": false,
    "properties": {
        "applications": {
            "type": "object",
            "additionalProperties": { "type": "string" }
        }
    },
    "required": [
        "applications"
    ]
}`;
    private static jobs: Job[] = [];
    private static resumeInspiration: string[] = [];
    private static applications: { [key: string]: string } = {};
    private static goodApplications: string[] = [];
    private static applicationsDir = path.join(process.cwd(), 'data/applications');
    private static runner = new Runner({ workflowName: 'application assistant' });
    private static personalInfoTool = tool({ //TODO #2
        name: '#personalInformation',
        description: 'Fetch personal information about someone from a file',
        parameters: z.object({}),
        execute: () => ApplicationAssistant.resumeInspiration
    });
    private static listOfJobsTool = tool({
        name: '#listOfJobs',
        description: 'Fetch a list of jobs',
        parameters: z.object({}),
        execute: () => ApplicationAssistant.jobs
    });
    private static goodApplicationsTool = tool({
        name: '#goodApplicationExamples',
        description: 'Fetch a list of examples of good job applications',
        parameters: z.object({}),
        execute: () => ApplicationAssistant.goodApplications
    });
    private static jobFilter = new Agent({
        name: 'jobFilter',
        instructions: 'You are someone who searches for jobs in a list. Fetch a list of jobs with the #listOfJobs tool and personal information with the #personalInformation tool. Use this information to select the 5 jobs that best match your personal information from the list of jobs. The list of Jobs is an array of JobInfo objects. JobInfo objects have this JSON schema: ' + this.jobSchema + ' Return the JobInfo objects for the 5 matching jobs as a JSON object that looks like this: {jobs: JobInfo[]}. Do not include any additional text or explanations. Do not modify the keys and values of the JobInfo objects.',
        model: 'gpt-5-nano',
        tools: [this.personalInfoTool, this.listOfJobsTool],
        outputType: z.object({
            jobs: z.array(ZJob)
        })
    });
    private static applicationWriter = new Agent({
        name: 'applicationWriter',
        instructions: 'Get the job list via the #listOfJobs tool and personal information via the #personalInformation tool. Create a complete HTML application for each job (inline CSS allowed, no external resources). Only output valid JSON (without Markdown/code block) that complies to this schema: ' + this.applicationSchema + ', like {“applications”:{“<id of job 1>”: “<HTML of job 1>”, “<id of job 2>”: “<HTML of job 2>”, ...}}. No line breaks within the HTML strings, escape quotation marks within HTML.',
        model: 'gpt-5',
        outputType: z.object({
            // Map of job ID (string) to application HTML
            applications: z.record(z.string()).nullable(),
        }),
        tools: [this.personalInfoTool, this.listOfJobsTool]
    });

    public static async start() {
        if (!fs.existsSync(path.join(process.cwd(), 'data'))) throw new Error('Data directory does not exist');
        if (!fs.existsSync(path.join(process.cwd(), 'data/resumeInspiration.json'))) throw new Error('Resume inspiration file does not exist at data/resumeInspiration.json');
        const rawResumeInspiration = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.json'), 'utf8'))
        const parsedResumeInspiration = await z.array(z.object({
            type: z.literal('text'),
            text: z.string()
        })).safeParseAsync(rawResumeInspiration);
        if (parsedResumeInspiration.error) throw new Error('Invalid resume inspiration data in data/resumeInspiration.json: ' + JSON.stringify(parsedResumeInspiration.error));
        this.resumeInspiration = parsedResumeInspiration.data.map(info => info.text);
        if (fs.existsSync(path.join(process.cwd(), 'data/jobs.json'))) {
            const parsedJobs = await z.array(ZJob).safeParseAsync(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/jobs.json'), 'utf8')));
            if (parsedJobs.error) throw new Error('Invalid jobs data in data/jobs.json: ' + JSON.stringify(parsedJobs.error));
            else this.jobs = parsedJobs.data;
        }
        else {
            const apify = new ApifyClient({
                token: fs.readFileSync(path.join(process.cwd(), 'secrets/apify_token'), 'utf8').trim()
            });
            const scrapedJobs = await apify.actor('curious_coder/linkedin-jobs-scraper').call({
                'urls': ['https://www.linkedin.com/jobs/search?keywords=Web%20Development&location=Hamburg&geoId=106430557&f_C=41629%2C11010661%2C162679%2C11146938%2C234280&distance=25&f_E=1%2C2&f_PP=106430557&f_TPR=&position=1&pageNum=0'],
                'count': 50
            }).then(run => apify.dataset<Job>(run.defaultDatasetId).listItems().then(res => res.items));
            const parsedJobs = await z.array(ZJob).safeParseAsync(scrapedJobs);
            if (parsedJobs.error) throw new Error('Invalid jobs data from Apify: ' + JSON.stringify(parsedJobs.error));
            else this.jobs = parsedJobs.data;
        }
        if (fs.existsSync(path.join(this.applicationsDir, 'goodResponses'))) {
            const files = fs.readdirSync(path.join(this.applicationsDir, 'goodResponses'));
            for (const fileName of files) {
                const fullPath = path.join(this.applicationsDir, 'goodResponses', fileName);
                try {
                    if (fs.statSync(fullPath).isFile()) this.goodApplications.push(fs.readFileSync(fullPath, 'utf8'));
                } catch { }
            }
        }
        const safeParseJson = <T>(raw: unknown): T | null => {
            if (raw === null) return null;
            if (typeof raw === 'object') return raw as T;
            if (typeof raw === 'string') {
                try {
                    return JSON.parse(raw) as T;
                } catch {
                    return null;
                }
            }
            return null;
        }
        let counter = 0;
        const jobsRun = await this.runner.run(this.jobFilter, 'Find matching jobs.', /*{ stream: true }*/);

        // jobsRun.toTextStream({
        //     compatibleWithNodeStreams: true
        // }).pipe(process.stdout);
        this.jobs = jobsRun.finalOutput ? ((): Job[] => {
            const parsed = safeParseJson<{ jobs?: unknown[] }>(jobsRun.finalOutput);
            if (!parsed || !Array.isArray(parsed.jobs)) {
                console.error('Failed to parse jobs from jobFilter. Final output was: ' + JSON.stringify(jobsRun.finalOutput));
                return [];
            };
            return parsed.jobs as Job[];
        })() : [];
        if (this.jobs.length === 0) throw new Error('No jobs returned from applicationFilter');
        const writerRun = await this.runner.run(this.applicationWriter, 'Write job applications for the listed jobs.');
        const writerJson = safeParseJson<{ applications: { [key: string]: string } }>(writerRun.finalOutput || '');
        if (!writerJson || !writerJson.applications) throw new Error('Invalid applications data from applicationWriter: ' + JSON.stringify(writerJson));
        this.applications = writerJson.applications;
        for (const [jobId, application] of Object.entries(this.applications)) {
            const qualityFilter = new Agent({
                name: 'applicationQualityFilter',
                instructions: 'You are someone who decides if a job application is a good job application by analyzing its similarities with the good examples provided by the #goodApplicationExamples tool. Return true if it\'s a good application, otherwise return false.',
                model: 'gpt-5-nano',
                tools: [this.goodApplicationsTool]
            });
            const goodApplication = await this.runner.run(qualityFilter, `Is the following job application a good one:\n\n${application}`);
            if (goodApplication.finalOutput === 'true' && application) {
                this.goodApplications.push(application);
                fs.writeFileSync(path.join(this.applicationsDir, `${jobId}.html`), application);
            }
        }
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});