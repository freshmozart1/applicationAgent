import { Agent, Runner } from "@openai/agents";
import { promptBuilder, safeCall } from "./helpers.js";
import { JobScraper } from "./jobScraper.js";
import path from "path";
import fs from "fs";
import { InvalidFilterOutputError } from "./errors.js";
import { Db, MongoClient } from "mongodb";

export class FilterAgent extends Agent<unknown, 'text'> {
    dataDir: string = path.join(process.cwd(), 'data');
    mongoClient: MongoClient;
    db: Db;

    async filterJobs() {
        let personalInformation: PersonalInformation;
        await this.mongoClient.connect();
        try {
            const coll = this.db.collection('personalInformation');
            const fetch = async <T>(type: string, msg: string) => {
                const doc = await coll.findOne<{ type: string; value: T }>({ type });
                if (!doc) throw new Error(msg);
                return doc.value;
            };
            const [contact, eligibility, constraints, preferences, skills, experience, education, certifications, languages_spoken, exclusions, motivations] = await Promise.all([
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
                fetch<PersonalInformationMotivation[]>('motivations', 'No motivations information found in personalInformation collection')
            ]);
            personalInformation = { contact, eligibility, constraints, preferences, skills, experience, education, certifications, languages_spoken, exclusions, motivations };
        } finally {
            await this.mongoClient.close();
        }
        if (!personalInformation) throw new Error('Personal information could not be loaded from database');
        const jobScraper = new JobScraper(this.dataDir);
        return jobScraper.scrapeJobs()
            .then(jobs => {
                const strippedJobsPromises = jobs.map(job => { });
                return Promise.all(jobs.map(job => {
                    const strippedJob = {
                        id: job.id,
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

                    this.instructions = promptBuilder('filter', [['{{PERSONAL_INFO}}', JSON.stringify(personalInformation)], ['{{JOB}}', JSON.stringify(strippedJob)]]);
                    return safeCall<Job | undefined>(
                        `filter.run(jobId=${strippedJob.id})`,
                        async (): Promise<Job | undefined> => {
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
                    );
                }));
            })
            .then(results => results.filter(job => !!job));
    }

    constructor() {
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
        if (!process.env.MONGODB_CONNECTION_STRING) throw new Error("MONGODB_CONNECTION_STRING is not set in environment variables");
        this.mongoClient = new MongoClient(process.env.MONGODB_CONNECTION_STRING);
        this.db = this.mongoClient.db('applicationAgentDB');
    }
}