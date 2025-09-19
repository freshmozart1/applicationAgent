import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { promptBuilder, safeCall } from "./helpers.js";
import { JobEvalSchema } from "./schemas.js";

const openai = new OpenAI();
let personal: PersonalInformation;

try {
    personal = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/personalInformation.json'), 'utf8'));
} catch (err) {
    console.error('Failed to load personalInformation.json:', err);
    process.exit(1);
}

const testDataFilename = 'jobVacancyTestData.jsonl';

const evalFileList = await safeCall('files.list(evals)', () => openai.files.list({
    purpose: 'evals'
}));

const foundTestData = evalFileList.data.find(f => f.filename === testDataFilename);
if (foundTestData) {
    try {
        await safeCall('files.delete(old test data)', () => openai.files.delete(foundTestData.id));
    } catch (err) {
        console.warn('Failed to delete old test data file, continuing anyway:', err);
    }
}
const testData = await safeCall('files.create(test data)', () => openai.files.create({
    file: fs.createReadStream(path.join(process.cwd(), testDataFilename)),
    purpose: 'evals'
}));
const evalList = await safeCall('evals.list', () => openai.evals.list());
const jobEvalName = 'Job Vacancy Evaluation';
let jobEvalId = evalList.data.find(f => f.name === jobEvalName)?.id;
if (!jobEvalId) {
    const created = await safeCall('evals.create(Job Vacancy Evaluation)', () => openai.evals.create({
        name: jobEvalName,
        data_source_config: {
            type: 'custom',
            item_schema: JobEvalSchema,
            include_sample_schema: true
        },
        testing_criteria: [{
            type: "string_check",
            name: jobEvalName,
            operation: "eq",
            input: '{{ sample.output_text }}',
            reference: '{{ item.fits }}'
        }]
    }));
    jobEvalId = created.id;
    console.log('Created new evaluation:', jobEvalId);
}

if (jobEvalId) {
    const evalRun = await safeCall('evals.runs.create', () => openai.evals.runs.create(jobEvalId, {
        name: jobEvalName + 'Run',
        data_source: {
            type: 'responses',
            model: 'gpt-5-nano',
            input_messages: {
                type: 'template',
                template: [
                    {
                        role: 'developer', content: promptBuilder('filter', [['{{PERSONAL_INFO}}', JSON.stringify(personal)], ['{{JOB}}', '{{item.job}}']])
                    },
                    {
                        role: 'user', content: `Evaluate the following job vacancy: {{item.job}}`
                    }
                ]
            },
            source: {
                type: 'file_id',
                id: testData.id
            }
        }
    }));
}
else {
    console.error('No evaluation ID found, cannot create evaluation run');
    process.exit(1);
}

// let jobEvalRunResponse;
// do {
//     jobEvalRunResponse = await openai.evals.runs.retrieve(jobEvalRun.id, {
//         eval_id: jobEvalId
//     });
//     console.log(`Job vacancy filter evaluation run status: ${jobEvalRunResponse.status}`);
// } while (jobEvalRunResponse.status === 'queued' || jobEvalRunResponse.status === 'in_progress');
// console.log('Job vacancy filter evaluation run finished:', jobEvalRunResponse.result_counts);
// console.log(jobEvalRunResponse.result_counts.passed / jobEvalRunResponse.result_counts.total * 100 + '% passed');
// console.log(`Visit https://platform.openai.com/evaluations/${jobEvalId}/data?run_id=${jobEvalRun.id} for more information`);
