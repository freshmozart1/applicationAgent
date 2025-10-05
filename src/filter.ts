import { Agent } from "@openai/agents";
import { promptBuilder } from "./helpers.js";

export class FilterAgent extends Agent<unknown, 'text'> {
    constructor(personalInformation: string, job: StrippedJob) {
        super({
            name: 'jobFilterAgent',
            model: 'gpt-5-nano',
            instructions: promptBuilder('filter', [['{{PERSONAL_INFO}}', personalInformation], ['{{JOB}}', JSON.stringify(job)]]),
            outputType: 'text',
            modelSettings: {
                maxTokens: 16000,
                reasoning: {
                    effort: 'high',
                    summary: "detailed"
                }
            }
        });
    }
}