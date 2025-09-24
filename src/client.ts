/**
 * This module contains the main code for the application assistant.
 */
import z from 'zod';
import fs from 'fs';
import path from 'path';
import { ApifyClient } from 'apify-client';
import { Agent, Runner, setTracingExportApiKey } from '@openai/agents';
import { safeCall } from './helpers.js';
import { InvalidFilterOutputError, InvalidWriterOutputError, ParsingAfterScrapeError, SingleJobSubsetTooLargeError } from './errors.js';
import { WriterAgent } from './writer.js';
import { FilterAgent } from './filter.js';
import { ZJob } from './schemas.js';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY environment variable not set');
setTracingExportApiKey(process.env.OPENAI_API_KEY!);

/**
 * This constant holds the current working directory of the Node process.
 */
const CWD = process.cwd();

/**
 * The ApplicationAssistant class encapsulates the functionality to scrape job vacancies from LinkedIn,
 * filter them based on suitability, and generate tailored application letters.
 */
class ApplicationAssistant {
    /**
     * This is the Apify client used to scrape job vacancies from LinkedIn.
     */
    private static apify = new ApifyClient({
        token: fs.readFileSync(path.join(CWD, 'secrets', 'apify_token'), 'utf8').trim()
    });
    /**
     * This directory contains all the necessary data files.
     */
    private static dataDir = path.join(CWD, 'data');
    /**
     * This array contains the URLs to scrape for job vacancies.
     */
    private static scrapeUrls = fs.readFileSync(path.join(this.dataDir, 'scrapeUrls.txt'), 'utf8').split('\n').map(l => l.trim());

    private static personalInformationPath = path.join(this.dataDir, 'personalInformation.json');
    /**
     * This string contains personal information and inspiration for writing application letters.
     * 
     * @remarks
     * Newlines are removed to ensure the prompt is a single continuous line.
     * 
     * This string contains the content of the file located at {@link personalInformationPath}.
     * 
     * personalInformation.json should contain:
     * - Personal information such as name, contact details, and a brief bio.
     * - Key skills and experiences relevant to the job applications.
     * - Examples of good application letters that were successful in the past.
     * - Examples of bad application letters that were unsuccessful, along with explanations of what made them ineffective. //todo #8
     * 
     * This information will be used by the AI to tailor application letters to better match the user's profile and improve their chances of success.
     */
    private static personalInformation: string = fs.readFileSync(this.personalInformationPath, 'utf8').replace(/(\r\n|\n|\r| {2,})/g, '');
    /**
     * This directory is where the generated application letters will be saved. It also contains good and bad application letters for reference.
     */
    private static applicationsDir = path.join(this.dataDir, 'applications');
    /**
     * This array holds the filtered job listings that are deemed suitable for application.
     */
    private static jobs: Job[] = [];
    /**
     * This is the {@link Runner} instance used to execute agents and manage workflows.
     */
    private static runner = new Runner({ workflowName: 'application assistant' });
    /**
     * Scrapes job listings from LinkedIn.
     * 
     * @returns A promise that resolves to an array of scraped job listings.
     * 
     * @throws {@link ParsingAfterScrapeError}
     * This exception is thrown if the scraped job listings cannot be parsed correctly.
     */
    private static async scrapeJobs(): Promise<Job[]> {
        /**
         * This is the path to the file that stores the ID of the last LinkedIn job scrape.
         * If the file does not exist or is older than a day, a new scrape will be performed.
         */
        const lastScrapePath = path.join(this.dataDir, 'lastScrapeId');
        /**
         * This variable holds the ID of the last scrape.
         */
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
        /**
         * This constant holds the result of parsing the scraped job listings using the {@link ZJob} schema.
         */
        const parsedJobs = await z.array(ZJob).safeParseAsync(await this.apify.dataset<Job>(lastScrapeId!).listItems().then(res => res.items));
        if (!parsedJobs.success) throw new ParsingAfterScrapeError(parsedJobs.error);
        return parsedJobs.data;
    }

    /**
     * This method uses an {@link Agent} to filter the scraped job vacancies based on their suitability for application.
     * @returns A promise that resolves to an array of job vacancies that are deemed suitable for application.
     */
    private static async filterJobs(): Promise<Job[]> {
        return await Promise.all((await this.scrapeJobs())
            .map(async (job: Job) => safeCall<Job | null>(
                `filter.run(jobId=${job.id})`,
                async () => {
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
                    const decision = (await this.runner.run<Agent<unknown, 'text'>, 'text'>(
                        new FilterAgent(this.personalInformation, strippedJob),
                        `Evaluate the following job vacancy: ${JSON.stringify(strippedJob)}`)
                    )
                        .finalOutput?.trim().toLowerCase();
                    if (decision === 'true') return job;
                    if (decision === 'false') return null;
                    throw new InvalidFilterOutputError();
                },
                {
                    retries: 20,
                    onRequestTooLarge: () => { throw new Error('Job object too large for filter agent'); }
                }
            )))
            .then(results => results.filter((job): job is Job => job !== null));
    }

    /**
     * This method generates job application letters for job vacancies.
     * @returns A promise that resolves to an array of generated job application letters.
     * 
     * @throws {@link InvalidWriterOutputError}
     * This exception is thrown if the writer agent does not return valid final output.
     * 
     * @remarks
     * The method uses two agents: a writer agent to generate the letters and an evaluator agent to assess their quality.
     * If the input to the writer agent is too large, it splits the job vacancies into smaller subsets and retries.
     * The method implements a retry mechanism for handling rate limiting errors from the OpenAI API.
     * Job application letters are generated based on the personal information and inspiration provided in the {@link personalInformation} string.
     * The generated letters are tailored to the specific job vacancies being applied for.
     * Application letters are written in HTML with inline CSS.
     */
    private static async writeApplications(jobs: Job[] = this.jobs): Promise<string[]> {
        const jl = jobs.length;
        if (jl === 0) return [];
        return Promise.allSettled(jobs.map(async job => safeCall<string>(
            `writer.run(jobId=${job.id})`,
            async () => {
                const letter = (await this.runner.run<Agent<string>, { job: Job }>(
                    new WriterAgent(job, this.personalInformation),
                    `Write a job application letter for the following job vacancy: ${JSON.stringify(job)}`
                )).finalOutput;
                if (letter && typeof letter === 'string') return letter;
                throw new InvalidFilterOutputError();
            },
            {
                retries: 5,
                onRequestTooLarge: () => { throw new SingleJobSubsetTooLargeError(); }
            }
        ))).then(async results => {
            const letters: string[] = [];
            let failedCounter = 0;
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    letters.push(result.value);
                } else {
                    failedCounter++;
                    console.error(`Failed to write application for jobId=${jobs[i].id}:`, String(result.reason).includes('RateLimitError') ? 'Rate limit exceeded' : result.reason);
                }
            }
            if (failedCounter > 0) console.warn(`Failed to write ${failedCounter}/${jl} applications.`);
            return letters;
        });
    }

    /**
     * Starts the application assistant
     */
    public static async start() {
        /**
         * This directory should contain the apify_token file with the Apify API token.
         */
        const secretsDir = path.join(CWD, 'secrets');
        /**
         * This array contains pairs of required paths error messages that will be thrown if the path does not exist.
         */
        const required: Array<[string, string]> = [
            [path.join(secretsDir, 'apify_token'), `Apify token file does not exist: ${secretsDir}/apify_token`],
            [path.join(CWD, 'data'), 'Data directory does not exist'],
            [secretsDir, 'Secrets directory does not exist'],
            [this.applicationsDir, `Applications directory does not exist: ${this.applicationsDir}`],
            [this.personalInformationPath, `Personal information file does not exist: ${this.personalInformationPath}`],
            [path.join(this.dataDir, 'scrapeUrls.txt'), `Scrape URLs file does not exist: ${path.join(this.dataDir, 'scrapeUrls.txt')}`]
        ];
        for (const [p, msg] of required) if (!fs.existsSync(p)) throw new Error(msg);
        /**
         * This array holds the job vacancies that are deemed suitable for application after filtering.
         */
        this.jobs = await this.filterJobs();
        console.log('These jobs match best:\n', this.jobs.map(job => '#' + job.id + ' ' + job.title + ' at ' + job.companyName).join('\n'));
        /**
         * This array holds the generated job application letters.
         * 
         * @remarks
         * Each letter is saved as an HTML file in the {@link applicationsDir} directory, with the filename corresponding to the job ID.
         */
        const applications = await this.writeApplications();
        for (const application of applications) {
            const filename = path.join(this.applicationsDir, `${this.jobs[applications.indexOf(application)].id}.html`);
            fs.writeFileSync(filename, application);
            console.log('Wrote application letter to', filename);
        }
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});