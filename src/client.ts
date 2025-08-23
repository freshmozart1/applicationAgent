import z from 'zod';
import fs from 'fs';
import path from 'path';
import { ApifyClient } from 'apify-client';

import { Agent, Runner, setTracingExportApiKey, tool } from '@openai/agents';

setTracingExportApiKey(process.env.OPENAI_API_KEY!);

interface PostalAddress {
    type?: 'PostalAddress' | string;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
}

const ZPostalAddress = z.object({
    type: z.string().optional(),
    streetAddress: z.string().optional(),
    addressLocality: z.string().optional(),
    addressRegion: z.string().optional(),
    postalCode: z.string().optional(),
    addressCountry: z.string().optional(),
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
    companySlogan?: string | undefined;
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
    companySlogan: z.string().or(z.undefined()),
    companyDescription: z.string(),
});

type Message_Text = {
    type: 'text';
    text: string;
};

const personalInfo = tool({
    name: '#personalInformation',
    description: 'Fetch personal information about someone from a file',
    parameters: z.object({}),
    execute: () => (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.json'), 'utf8')) as Message_Text[]).map(info => info.text)
});

let jobs = tool({
    name: '#jobs',
    description: 'Fetch a list of jobs from a file',
    parameters: z.object({}),
    execute: () => {
        if (!fs.existsSync(path.join(process.cwd(), 'data/jobs.json'))) {
            const apify = new ApifyClient({
                token: fs.readFileSync(path.join(process.cwd(), 'secrets/apify_token'), 'utf8').trim()
            });
            return apify.actor('curious_coder/linkedin-jobs-scraper').call({
                'urls': ['https://www.linkedin.com/jobs/search?keywords=Web%20Development&location=Hamburg&geoId=106430557&f_C=41629%2C11010661%2C162679%2C11146938%2C234280&distance=25&f_E=1%2C2&f_PP=106430557&f_TPR=&position=1&pageNum=0'],
                'count': 100
            }).then(run => apify.dataset<Job>(run.defaultDatasetId).listItems().then(res => res.items));
        } else {
            const parsedJobs = z.array(ZJob).parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/jobs.json'), 'utf8')));
            if (!parsedJobs || parsedJobs.length === 0) {
                throw new Error('No jobs found in data/jobs.json');
            }
            return parsedJobs;
        }
    }
});

const applicationFilter = new Agent({
    name: 'applicationFilter',
    instructions: 'You are someone who searches for jobs in a list. You have a list of jobs and personal information. Use this information to select the 10 jobs that best match your personal information from the list. Output a JSON array containing the 10 selected job objects.',
    model: 'gpt-5-nano',
    outputType: 'text',
    tools: [personalInfo, jobs]
});

const runner = new Runner({
    workflowName: 'application assistant'
})

const filteredJobs = await runner.run(applicationFilter, 'Find jobs that match my personal information.');

jobs = tool({
    name: '#jobs',
    description: 'Fetch a list of jobs',
    parameters: z.object({}),
    execute: () => filteredJobs.finalOutput || '[]'
});

const goodApplicationResponse = tool({
    name: '#goodApplicationResponse',
    description: 'Fetch a list of good job applications from a file',
    parameters: z.object({}),
    execute: () => (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/applications.json'), 'utf8')) as { [key: string]: string }[]).map
});

const applicationWriter = new Agent({
    name: 'applicationWriter',
    instructions: 'You are someone who writes a job application. Fetch a list of jobs with the #jobs tool. Iterate over all jobs in the list and write a job application for each job. Style each application by using HTML and inline CSS. Output a JSON array containing the HTML and inline CSS code for each job application. The output must be a mapping of job ids to HTML/CSS code. Do not include any new line characters in the output.',
    model: 'gpt-5',
    outputType: 'text',
    tools: [personalInfo, jobs]
});

const applications = await runner.run(applicationWriter, 'Write job applications for the selected jobs.');
fs.writeFileSync(path.join(process.cwd(), 'data/applications.json'), applications.finalOutput || '[]');