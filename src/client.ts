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

const zMessageText = z.object({
    type: z.literal('text'),
    text: z.string()
});

// const personalInfo = tool({
//     name: '#personalInformation',
//     description: 'Fetch personal information about someone from a file',
//     parameters: z.object({}),
//     execute: () => (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.json'), 'utf8')) as Message_Text[]).map(info => info.text)
// });

// let jobs = tool({
//     name: '#jobs',
//     description: 'Fetch a list of jobs from a file',
//     parameters: z.object({}),
//     execute: () => {
//         if (!fs.existsSync(path.join(process.cwd(), 'data/jobs.json'))) {
//             const apify = new ApifyClient({
//                 token: fs.readFileSync(path.join(process.cwd(), 'secrets/apify_token'), 'utf8').trim()
//             });
//             return apify.actor('curious_coder/linkedin-jobs-scraper').call({
//                 'urls': ['https://www.linkedin.com/jobs/search?keywords=Web%20Development&location=Hamburg&geoId=106430557&f_C=41629%2C11010661%2C162679%2C11146938%2C234280&distance=25&f_E=1%2C2&f_PP=106430557&f_TPR=&position=1&pageNum=0'],
//                 'count': 100
//             }).then(run => apify.dataset<Job>(run.defaultDatasetId).listItems().then(res => res.items));
//         } else {
//             const parsedJobs = z.array(ZJob).parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/jobs.json'), 'utf8')));
//             if (!parsedJobs || parsedJobs.length === 0) {
//                 throw new Error('No jobs found in data/jobs.json');
//             }
//             return parsedJobs;
//         }
//     }
// });

// let applicationFilter = new Agent({
//     name: 'applicationFilter',
//     instructions: 'You are someone who searches for jobs in a list. You have a list of jobs and personal information. Use this information to select the 10 jobs that best match your personal information from the list. Output a JSON array containing the 10 selected job objects.',
//     model: 'gpt-5-nano',
//     outputType: 'text',
//     tools: [personalInfo, jobs]
// });

// const runner = new Runner({
//     workflowName: 'application assistant'
// })

// jobs = tool({
//     name: '#jobs',
//     description: 'Fetch a list of jobs',
//     parameters: z.object({}),
//     execute: async () => (await runner.run(applicationFilter, 'Find 10 jobs that match my personal information.')).finalOutput || '[]'
// });

// const goodApplications = tool({
//     name: '#goodApplicationExamples',
//     description: 'Fetch a list of examples of good job applications',
//     parameters: z.object({}),
//     execute: () => {
//         const goodApplications = [];
//         const goodResponsesDir = path.join(process.cwd(), 'data/applications/goodResponses');
//         if (fs.existsSync(goodResponsesDir)) {
//             const files = fs.readdirSync(goodResponsesDir);
//             for (const fileName of files) {
//                 const fullPath = path.join(goodResponsesDir, fileName);
//                 try {
//                     if (fs.statSync(fullPath).isFile()) goodApplications.push(fs.readFileSync(fullPath, 'utf8'));
//                 } catch {
//                     // Ignore unreadable files
//                 }
//             }
//         }
//         return goodApplications;
//     }
// });

// const applicationWriter = new Agent({
//     name: 'applicationWriter',
//     instructions: 'You are someone who writes a job application. Fetch a list of jobs with the #jobs tool. Iterate over all jobs in the list and write a job application for each job that matches your personal information. Extract personal information from the #personalInformation tool. Style each application by using HTML and inline CSS. Output a JSON object containing a HTML with inline CSS code for each job application. The output must be a mapping of job ids to HTML/CSS code. Do not include any new line characters in the output.',
//     model: 'gpt-5',
//     tools: [personalInfo, jobs]
// });

// const applications = await runner.run(applicationWriter, 'Write job applications for the selected jobs.');
// // Normalize final output into a map of jobId -> application HTML
// let applicationMap: Record<string, string> = {};
// if (applications.finalOutput) {
//     if (typeof applications.finalOutput === 'string') {
//         try {
//             applicationMap = JSON.parse(applications.finalOutput);
//         } catch (err) {
//             console.error('Failed to parse applications.finalOutput JSON:', err);
//         }
//     } else if (typeof applications.finalOutput === 'object') {
//         applicationMap = applications.finalOutput as Record<string, string>;
//     }
// }
// const applicationsDir = path.join(process.cwd(), 'data/applications');
// fs.mkdirSync(applicationsDir, { recursive: true });
// for (const [jobId, application] of Object.entries(applicationMap)) {
//     const htmlCreator = new Agent({
//         name: '#htmlCreator',
//         instructions: 'You are someone who creates HTML documents. Take the job application provided and generate a complete HTML document with inline CSS styles. The output must be a valid HTML document.',
//         model: 'gpt-5-nano',
//         tools: []
//     });
//     const htmlDocument = await runner.run(htmlCreator, `Create a complete HTML document with inline CSS styles for the following job application:\n\n${application}`);
//     applicationFilter = new Agent({
//         name: 'applicationFilter',
//         instructions: 'You are someone who filters job applications by keeping only the ones that share similar characteristics with the good examples provided by the #goodApplicationExamples tool.',
//         model: 'gpt-5-nano',
//         outputType: 'text',
//         tools: [goodApplications]
//     });
//     const goodApplication = await runner.run(applicationFilter, `Compare this job application:\n\n${htmlDocument.finalOutput}\n\n with the good examples provided by the #goodApplicationExamples tool. If the application is good, return it as the final output. If it is not good, do not return anything.`);
//     if (goodApplication.finalOutput && htmlDocument.finalOutput) {
//         fs.writeFileSync(path.join(applicationsDir, `${jobId}.html`), htmlDocument.finalOutput);
//     }
// }

class ApplicationAssistant {
    private static jobs: Job[] = [];
    private static resumeInspiration: string[] = [];
    private static applications: Record<string, string> = {};
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
    private static applicationFilter = new Agent({
        name: 'applicationFilter',
        instructions: 'You are someone who searches for jobs in a list. Fetch a list of jobs with the #listOfJobs tool and personal information with the #personalInformation tool. Use this information to select the 10 jobs that best match your personal information from the list of jobs.',
        model: 'gpt-5-nano',
        outputType: z.object({
            jobs: z.array(ZJob)
        }),
        tools: [this.personalInfoTool, this.listOfJobsTool]
    });
    private static applicationWriter = new Agent({
        name: 'applicationWriter',
        instructions: 'You are someone who writes a job application. Fetch a list of jobs with the #jobs tool. Iterate over all jobs in the list and write a job application for each job. Style each application by using HTML and inline CSS. Output a JSON object containing a HTML with inline CSS code for each job application. The output must be a mapping of job ids to HTML/CSS code. Do not include any new line characters in the output.',
        model: 'gpt-5',
        outputType: z.object({
            applications: z.record(z.string(), z.string())
        }),
        tools: [this.personalInfoTool, this.listOfJobsTool]
    });

    private static htmlCreator = new Agent({
        name: '#htmlCreator',
        instructions: 'You are someone who creates HTML documents. Take the job application provided and generate a complete HTML document with inline CSS styles. The output must be a valid HTML document.',
        model: 'gpt-5-nano',
        outputType: 'text'
    });

    public static async start() {
        if (!fs.existsSync(path.join(process.cwd(), 'data'))) throw new Error('Data directory does not exist');
        if (!fs.existsSync(path.join(process.cwd(), 'data/resumeInspiration.json'))) throw new Error('Resume inspiration file does not exist at data/resumeInspiration.json');
        const rawResumeInspiration = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.json'), 'utf8'))
        const parsedResumeInspiration = await z.array(zMessageText).safeParseAsync(rawResumeInspiration);
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
        this.jobs = (await this.runner.run(this.applicationFilter, 'Find 10 jobs that match my personal information.')).finalOutput?.jobs || [];
        if (this.jobs.length === 0) throw new Error('No jobs returned from applicationFilter');
        const tenApplications = (await this.runner.run(this.applicationWriter, 'Write job applications for the listed jobs.')).finalOutput?.applications;
        const parsedTenApplications = await z.record(z.string(), z.string()).safeParseAsync(tenApplications);
        if (parsedTenApplications.error) throw new Error('Invalid applications data from applicationWriter: ' + JSON.stringify(parsedTenApplications.error));
        this.applications = parsedTenApplications.data
        for (const [jobId, application] of Object.entries(this.applications)) {
            const applicationHtml = await this.runner.run(this.htmlCreator, `Create a complete HTML document with inline CSS styles for the following job application:\n\n${application}`);
            const qualityFilter = new Agent({
                name: 'applicationQualityFilter',
                instructions: 'You are someone who decides if a job application is a good job application by analyzing its similarities with the good examples provided by the #goodApplicationExamples tool. Return true if it\'s a good application, otherwise return false.',
                model: 'gpt-5-nano',
                outputType: 'text',
                tools: [this.goodApplicationsTool]
            });
            const goodApplication = await this.runner.run(qualityFilter, `Is the following job application a good one:\n\n${JSON.stringify(applicationHtml)}`);
            if (goodApplication.finalOutput === 'true' && applicationHtml.finalOutput) {
                this.goodApplications.push(applicationHtml.finalOutput);
                fs.writeFileSync(path.join(this.applicationsDir, `${jobId}.html`), applicationHtml.finalOutput);
            }
        }
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});