import { Agent } from "@openai/agents";
import { promptBuilder } from "./helpers.js";

type StrippedJob = {
    title: string;
    companyName: string;
    location: string;
    descriptionText: string;
    salaryInfo: string[];
    salary: string;
    industries: string | undefined;
    employmentType: string;
    seniorityLevel: string | undefined;
    companySize: number | undefined;
}

export class FilterAgent extends Agent<unknown, 'text'> {
    constructor(personalInformation: string, job: StrippedJob) {
        super({
            name: 'jobFilterAgent',
            model: 'gpt-5-nano',
            instructions: promptBuilder('filter', [['{{PERSONAL_INFO}}', personalInformation], ['{{JOB}}', JSON.stringify(job)]]),
            outputType: 'text',
        });
    }
}