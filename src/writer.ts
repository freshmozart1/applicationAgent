import { Agent, webSearchTool, tool, Runner } from "@openai/agents";
import { promptBuilder, safeCall } from "./helpers.js";
import { InvalidEvaluationOutputError } from "./errors.js";
import { EvaluationToolSchema } from "./schemas.js";

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
    constructor(jobVacancy: Job, personalInformation: string) {
        super({
            name: 'jobApplicationWriter',
            instructions: promptBuilder('writer', [
                ['{{PERSONAL_INFO}}', personalInformation]
            ]),
            model: 'gpt-5-nano',
            outputType: 'text',
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
                }),
                tool({
                    name: '#evaluation',
                    description: 'Evaluate the quality of a job application letter.',
                    parameters: EvaluationToolSchema,
                    async execute({ letter }: { letter: string }) {
                        const evaluationOutput = (await safeCall(
                            `writer.evaluate`,
                            () => (new Runner({ workflowName: 'applicationAssistant' }))
                                .run(
                                    new EvaluatorAgent(),
                                    `Evaluate the following job application letter:\n\n${letter}\n\nReturn "good" or "bad".`
                                ),
                            {
                                retries: 10
                            }
                        )).finalOutput;
                        if (evaluationOutput !== 'good' && evaluationOutput !== 'bad') throw new InvalidEvaluationOutputError();
                        return evaluationOutput;
                    }
                })
            ]
        });
    }
}