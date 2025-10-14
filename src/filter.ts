import { Agent } from "@openai/agents";
import { promptBuilder } from "./helpers.js";
import { AgentTypeEnum } from "./enums.js";

export class FilterAgent extends Agent<unknown, 'text'> {
    constructor(personalInformation: PersonalInformation, job: StrippedJob) {
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
            },
            instructions: promptBuilder(AgentTypeEnum.Filter, [['{{PERSONAL_INFO}}', JSON.stringify(personalInformation)], ['{{JOB}}', JSON.stringify(job)]])
        });
    }
}