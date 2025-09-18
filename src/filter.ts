import { Agent } from "@openai/agents";
import { promptBuilder } from "./helpers.js";
import { Job } from "./client.js";

export class FilterAgent extends Agent<unknown, 'text'> {
    constructor(personalInformation: string, job: Job) {
        super({
            name: 'jobFilterAgent',
            model: 'gpt-5-nano',
            instructions: promptBuilder('filter', [['{{PERSONAL_INFO}}', personalInformation], ['{{JOB}}', JSON.stringify(job)]]),
            outputType: 'text',
        });
    }
}