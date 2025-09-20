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

const testFilePath = path.join(process.cwd(), 'data/filterTestData.json');
if (!fs.existsSync(testFilePath)) throw new Error('Test data file not found: ' + testFilePath);
const testData: { fits: boolean, job: Job }[] = JSON.parse(fs.readFileSync(testFilePath, 'utf8')) as { fits: boolean, job: Job }[];
if (!Array.isArray(testData)) throw new Error('Test data is not an array in file: ' + testFilePath);
for (let item of testData) {
    const parseResult = JobEvalSchema.safeParse(item);
    if (!parseResult.success) {
        throw new Error('Test data item does not conform to schema: ' + JSON.stringify(parseResult.error.issues));
    }
}

for (const file of (await openai.files.list({ purpose: 'evals' })).data) {
    if (file.filename.startsWith('jobEval') && file.filename.endsWith('.jsonl')) openai.files.delete(file.id);
}

const jobEvalName = 'Job Vacancy Evaluation';
const evalList = await openai.evals.list();
let jobEvalId = evalList.data.find(e => e.name === jobEvalName)?.id;
const chunkSize = 16;

if (!jobEvalId) {
    jobEvalId = (await openai.evals.create({
        name: jobEvalName,
        data_source_config: {
            type: 'custom',
            item_schema: JobEvalSchema.shape,
            include_sample_schema: true
        },
        testing_criteria: [{
            type: 'string_check',
            name: jobEvalName,
            operation: 'eq',
            input: '{{ sample.output_text }}',
            reference: '{{ item.fits }}'
        }]
    })).id;
}

if (jobEvalId) {
    for (let i = 0; i < testData.length; i += chunkSize) {
        const chunk = testData.slice(i, i + chunkSize);
        const tmpName = path.join(process.cwd(), `jobEval${Math.floor(i / chunkSize)}.jsonl`); // short file name
        fs.writeFileSync(
            tmpName,
            chunk.reduce((acc, item, index) => `${acc}{"item":${JSON.stringify(item)}}${index < chunk.length - 1 ? '\n' : ''}`, ''),
            'utf8');
        try {
            const file = await openai.files.create({
                file: fs.createReadStream(tmpName),
                purpose: 'evals'
            });
            console.log('Uploaded eval file:', file.id, file.filename);
            setTimeout(async () => await openai.evals.runs.create(jobEvalId, {
                name: `${jobEvalName} Run ${Math.floor(i / chunkSize) + 1}`,
                data_source: {
                    type: 'responses',
                    model: 'gpt-5-nano',
                    input_messages: {
                        type: 'template',
                        template: [
                            {
                                role: 'system', content: promptBuilder('filter', [['{{PERSONAL_INFO}}', JSON.stringify(personal)], ['{{JOB}}', '{{item.job}}']])
                            },
                            {
                                role: 'user', content: `Evaluate the following job vacancy: {{item.job}}`
                            }
                        ]
                    },
                    source: {
                        type: 'file_id',
                        id: file.id
                    }
                }
            }), Math.floor(i / chunkSize) > 0 ? 60000 : 0);
        } catch (err) {
            console.error('Running evaluation failed:', err);
        } finally {
            try { fs.unlinkSync(tmpName); } catch { }
        }
    }
}
