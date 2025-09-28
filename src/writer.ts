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
    constructor(personalInformation: string, companyDomain: string, exampleApplicationLetters: string[] = []) {
        super({
            name: 'jobApplicationWriter',
            instructions: promptBuilder('writer', [
                ['{{PERSONAL_INFO}}', personalInformation],
                ['{{EXAMPLES}}', exampleApplicationLetters.length ? exampleApplicationLetters.reduce((prev, curr, idx) => prev + `Example ${idx + 1}:\n${curr}\n\n`, '') : 'No examples provided.'],
            ]),
            model: 'gpt-5-mini',
            outputType: 'text',
            modelSettings: {
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
                    },
                    filters: {
                        allowedDomains: [
                            /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)$/.test(companyDomain) ? (new URL(companyDomain)).hostname : companyDomain,
                            'linkedin.com',
                            'xing.com',
                            'crunchbase.com',
                            'glassdoor.com',
                            'kununu.com',
                            'indeed.com',
                            'google.com',
                            'wikipedia.org',
                            'facebook.com',
                            'x.com',
                            'reddit.com',
                            'instagram.com',
                            'youtube.com'
                        ]
                    }
                })
            ]
        });
    }
}