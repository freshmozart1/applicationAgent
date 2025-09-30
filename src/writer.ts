import { Agent, webSearchTool, tool, Runner } from "@openai/agents";
import { promptBuilder, safeCall } from "./helpers.js";

class EvaluatorAgent extends Agent<string> {
    constructor() {
        super({
            name: 'responseEvaluator',
            instructions: promptBuilder('evaluator'),
            model: 'gpt-5-nano',
            outputType: 'text',
        });
    }
}

export class WriterAgent extends Agent<string> {
    constructor(personalInformation: string, exampleApplicationLetters: string[] = []) {
        super({
            name: 'jobApplicationWriter',
            instructions: promptBuilder('writer', [
                ['{{PERSONAL_INFO}}', personalInformation],
                ['{{EXAMPLES}}', exampleApplicationLetters.length ? exampleApplicationLetters.reduce((prev, curr, idx) => prev + `Example ${idx + 1}:\n${curr}\n\n`, '') : 'No examples provided.'],
            ]),
            model: 'gpt-5-mini',
            outputType: 'text',
            modelSettings: {
                maxTokens: 15000,
                reasoning: {
                    effort: 'high',
                    summary: 'detailed'
                }
            },
            tools: [
                webSearchTool({
                    name: '#webSearch',
                    searchContextSize: 'medium',
                    userLocation: {
                        city: 'Hamburg',
                        region: 'Hamburg',
                        country: 'DE',
                        timezone: 'Europe/Berlin',
                        type: 'approximate'
                    }
                })
            ]
        });
    }
}