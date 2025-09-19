import { Agent } from "@openai/agents";
import { promptBuilder } from "./helpers.js";
import { InvalidEvaluationOutputError } from "./errors.js";

export class WriterAgent extends Agent<string> {
    constructor(jobVacancies: Job[], personalInformation: string) {
        super({
            name: 'jobApplicationWriter',
            instructions: promptBuilder('writer', [
                ['{{PERSONAL_INFO}}', personalInformation],
                ['{{JOBS_SUBSET}}', JSON.stringify(jobVacancies)],
                ['{{JOBS_SUBSET_LENGTH}}', String(jobVacancies.length)]
            ]),
            model: 'gpt-5-nano',
            outputType: 'text',
            tools: [
                (new Agent<string>({
                    name: 'responseEvaluator',
                    instructions: promptBuilder('evaluator'),
                    model: 'gpt-5-nano',
                    outputType: 'text',
                    handoffDescription: 'Evaluate the quality of a job application letter.'
                })).asTool({
                    toolName: '#evaluation',
                    toolDescription: 'Evaluate a single job application letter. Returns "good" or "bad".',
                    customOutputExtractor:
                        /**
                         * This function extracts and validates the evaluation result from the output of the evaluator agent.
                         * @param o The output from the evaluator agent.
                         * @returns The evaluation result, either "good" or "bad".
                         * @throws {@link InvalidEvaluationOutputError}
                         */
                        (o: unknown) => {
                            /**
                             * This constant holds the evaluation result after processing the output from the evaluator agent.
                             */
                            const evaluation = typeof o === 'string' && o.trim().toLowerCase();
                            if (evaluation === 'good' || evaluation === 'bad') return evaluation;
                            throw new InvalidEvaluationOutputError();
                        }
                })
            ]
        });
    }
}