import { Agent, Runner } from "@openai/agents";
import { promptBuilder, safeCall } from "./helpers.js";
import { JobScraper } from "./jobScraper.js";
import path from "path";
import fs from "fs";
import { InvalidFilterOutputError } from "./errors.js";

export class FilterAgent extends Agent<unknown, 'text'> {
    dataDir: string = path.join(process.cwd(), 'data');
    personalInformation: string;
    async filterJobs() {
        const jobScraper = new JobScraper(this.dataDir);
        return jobScraper.scrapeJobs()
            .then(jobs => Promise.all(jobs.map(job => safeCall<Job | undefined>(
                `filter.run(jobId=${job.id})`,
                async (): Promise<Job | undefined> => {
                    const strippedJob = {
                        title: job.title,
                        companyName: job.companyName,
                        location: job.location,
                        descriptionText: job.descriptionText,
                        salaryInfo: job.salaryInfo,
                        salary: job.salary,
                        industries: job.industries,
                        employmentType: job.employmentType,
                        seniorityLevel: job.seniorityLevel,
                        companySize: job.companyEmployeesCount
                    };
                    this.instructions = promptBuilder('filter', [['{{PERSONAL_INFO}}', this.personalInformation], ['{{JOB}}', JSON.stringify(job)]]);
                    const decision = (await (new Runner({ workflowName: 'application assistant' })).run<Agent<unknown, 'text'>>(
                        this,
                        `Evaluate the following job vacancy: ${JSON.stringify(strippedJob)}`
                    )).finalOutput?.trim().toLowerCase();
                    if (decision === 'true') return job;
                    if (decision === 'false') return;
                    throw new InvalidFilterOutputError();
                },
                {
                    retries: 20,
                    onRequestTooLarge: () => { throw new Error('Job object too large for filter agent'); }
                }
            ))))
            .then(results => results.filter(job => !!job));
    }

    constructor(personalInformation: string) {
        super({
            name: 'jobFilterAgent',
            model: 'gpt-5-nano',
            outputType: 'text',
            modelSettings: {
                maxTokens: 16000,
                reasoning: {
                    effort: 'high',
                    summary: "detailed"
                }
            }
        });
        if (!fs.existsSync(this.dataDir)) throw new Error(`Data directory not found: ${this.dataDir}`);
        this.personalInformation = personalInformation;
    }
}