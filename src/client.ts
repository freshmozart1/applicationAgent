/**
 * This module contains the main code for the application assistant.
 */
import fs from 'fs';
import path from 'path';
import { Agent, Runner, setTracingExportApiKey } from '@openai/agents';
import { safeCall } from './helpers.js';
import { InvalidFilterOutputError, NoMongoDBConnectionStringError, SingleJobSubsetTooLargeError } from './errors.js';
import { WriterAgent } from './writer.js';
import { FilterAgent } from './filter.js';
import { JobScraper } from './jobScraper.js';
import { MongoClient } from 'mongodb';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY environment variable not set');
if (!process.env.MONGODB_CONNECTION_STRING) throw new NoMongoDBConnectionStringError();
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
     * This directory contains all the necessary data files.
     */
    private static dataDir = path.join(CWD, 'data');
    /**
     * This is the path to the HTML template file used for generating application letters.
     */
    private static templateDir = path.join(this.dataDir, 'template.html');

    /**
     * This directory is where the generated application letters will be saved. It also contains good and bad application letters for reference.
     */
    private static applicationsDir = path.join(this.dataDir, 'applications');

    /**
     * This directory contains example application letters that will be used for inspiration by the writer agent.
     */
    private static examplesDir = path.join(this.applicationsDir, 'examples');
    /**
     * This is the {@link Runner} instance used to execute agents and manage workflows.
     */
    private static runner = new Runner({ workflowName: 'application assistant' });

    private static mongoClient: MongoClient = new MongoClient(process.env.MONGODB_CONNECTION_STRING!);
    private static db = this.mongoClient.db('applicationAgentDB');

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
    private static async writeApplications(personalInformation: PersonalInformation, jobs: Job[]): Promise<{ filename: string, letter: string }[]> {
        const jl = jobs.length;
        if (jl === 0) return [];
        return Promise.allSettled(jobs.map(async job => safeCall<{ filename: string, letter: string }>(
            `writer.run(jobId=${job.id})`,
            async () => {
                const letter = (await this.runner.run<Agent<string>, { job: Job }>(
                    new WriterAgent(
                        JSON.stringify(personalInformation),
                        fs.readdirSync(this.examplesDir)
                            .filter(f => f.endsWith('.html'))
                            .map(f => fs.readFileSync(path.join(this.examplesDir, f), 'utf8')),
                        fs.readFileSync(this.templateDir, 'utf8')
                    ),
                    `Write a letter of motivation for the following job vacancy: ${JSON.stringify(job)}`
                )).finalOutput;
                if (letter && typeof letter === 'string') return {
                    filename: path.join(this.applicationsDir, `${job.id}.html`),
                    letter
                };
                throw new InvalidFilterOutputError();
            },
            {
                retries: 5,
                onRequestTooLarge: () => { throw new SingleJobSubsetTooLargeError(); }
            }
        ))).then(results => {
            const letters: { filename: string, letter: string }[] = [];
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
         * This array contains pairs of required paths error messages that will be thrown if the path does not exist.
         */
        const required: Array<[string, string]> = [
            [this.dataDir, 'Data directory does not exist'],
            [this.applicationsDir, `Applications directory does not exist: ${this.applicationsDir}`],
            [this.examplesDir, `Examples directory does not exist: ${this.examplesDir}`],
            [this.templateDir, `HTML template file does not exist: ${this.templateDir}`]
        ];
        for (const [p, msg] of required) if (!fs.existsSync(p)) throw new Error(msg);

        let personalInformation: PersonalInformation;
        try {
            await this.mongoClient.connect();
            await this.db.command({ ping: 1 });
            const coll = this.db.collection('personalInformation');
            const fetch = async <T>(type: string, msg: string) => {
                const doc = await coll.findOne<{ type: string; value: T }>({ type });
                if (!doc) throw new Error(msg);
                return doc.value;
            };
            const [contact, eligibility, constraints, preferences, skills, experience, education, certifications, languages_spoken, exclusions, motivations, career_goals] = await Promise.all([
                fetch<PersonalInformationContact>('contact', 'No contact information found in personalInformation collection'),
                fetch<PersonalInformationEligibility>('eligibility', 'No eligibility information found in personalInformation collection'),
                fetch<PersonalInformationConstraints>('constraints', 'No constraints information found in personalInformation collection'),
                fetch<PersonalInformationPreferences>('preferences', 'No preferences information found in personalInformation collection'),
                fetch<PersonalInformationSkill[]>('skills', 'No skills information found in personalInformation collection'),
                fetch<PersonalInformationExperience>('experience', 'No experience information found in personalInformation collection'),
                fetch<PersonalInformationEducation[]>('education', 'No education information found in personalInformation collection'),
                fetch<PersonalInformationCertification[]>('certifications', 'No certifications information found in personalInformation collection'),
                fetch<PersonalInformationLanguageSpoken[]>('languages_spoken', 'No languages spoken information found in personalInformation collection'),
                fetch<PersonalInformationExclusions>('exclusions', 'No exclusions information found in personalInformation collection'),
                fetch<PersonalInformationMotivation[]>('motivations', 'No motivations information found in personalInformation collection'),
                fetch<PersonalInformationCareerGoal[]>('career_goals', 'No career goals information found in personalInformation collection')
            ]);
            personalInformation = { contact, eligibility, constraints, preferences, skills, experience, education, certifications, languages_spoken, exclusions, motivations, career_goals };
        } finally {
            await this.mongoClient.close();
        }
        const jobsToApply = (await Promise.allSettled(
            (await new JobScraper(this.dataDir).scrapeJobs()).map(job =>
                safeCall<Job | null>(
                    `filter.run(jobId=${job.id})`,
                    async () => {
                        const result = (await this.runner.run<FilterAgent, { job: StrippedJob }>(
                            new FilterAgent(
                                personalInformation,
                                {
                                    id: job.id,
                                    title: job.title,
                                    companyName: job.companyName,
                                    location: job.location,
                                    descriptionText: job.descriptionText,
                                    salary: job.salary,
                                    salaryInfo: job.salaryInfo,
                                    industries: job.industries,
                                    employmentType: job.employmentType,
                                    seniorityLevel: job.seniorityLevel,
                                    companySize: job.companyEmployeesCount
                                }
                            ),
                            'Decide if the job vacancy is suitable for application.'
                        )).finalOutput;
                        if (result === 'true') return job;
                        if (result === 'false') return null;
                        throw new InvalidFilterOutputError();
                    }
                )
            )
        ));

        const acceptedJobs = jobsToApply.filter(r => r.status === 'fulfilled' && r.value !== null) as PromiseFulfilledResult<Job>[];
        const rejectedJobs = jobsToApply.filter(r => r.status === 'fulfilled' && r.value === null).length;
        const failedJobs = jobsToApply.filter(r => r.status === 'rejected').length;
        console.log(`Out of ${jobsToApply.length} jobs, ${acceptedJobs.length} were accepted, ${rejectedJobs} were rejected, and ${failedJobs} failed.`);
        for (const { filename, letter } of await this.writeApplications(personalInformation, acceptedJobs.map(r => r.value))) {
            fs.writeFileSync(filename, letter);
            console.log('Wrote application letter to', filename);
        }
    }
}

ApplicationAssistant.start().catch(err => {
    console.error('Error starting ApplicationAssistant:', err);
});