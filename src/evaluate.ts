import OpenAI from "openai";
import fs from "fs";
import path from "path";

const openai = new OpenAI();
const personal = fs.readFileSync(path.join(process.cwd(), 'data/resumeInspiration.txt'), 'utf8').replace(/[\r\n]+/g, '');
const instructions = `You are an expert in categorizing job vacancies. Your task is to evaluate whether a given job vacancy fits to your personal information. Respond with the word 'true', if the job vacancy fits to your personal information, otherwise respond with the word 'false'.`;
const evalFileList = await openai.files.list({
    purpose: 'evals'
});
const testDataFilename = 'jobVacancyTestData.jsonl';
const foundTestData = evalFileList.data.find(f => f.filename === testDataFilename);
if (foundTestData) await openai.files.delete(foundTestData.id);
const testData = await openai.files.create({
    file: fs.createReadStream(path.join(process.cwd(), testDataFilename)),
    purpose: 'evals'
});
const evalList = await openai.evals.list();
const jobEvalName = 'Job Vacancy Evaluation';
let jobEvalId = evalList.data.find(f => f.name === jobEvalName)?.id;
if (!jobEvalId) {
    jobEvalId = (await openai.evals.create({
        name: 'Job Vacancy Evaluation',
        data_source_config: {
            type: 'custom',
            item_schema: {
                "type": "object",
                "properties": {
                    "fits": {
                        "type": "string"
                    },
                    "job": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string"
                            },
                            "trackingId": {
                                "type": "string"
                            },
                            "refId": {
                                "type": "string"
                            },
                            "link": {
                                "type": "string"
                            },
                            "title": {
                                "type": "string"
                            },
                            "companyName": {
                                "type": "string"
                            },
                            "companyLinkedinUrl": {
                                "type": "string"
                            },
                            "companyLogo": {
                                "type": "string"
                            },
                            "location": {
                                "type": "string"
                            },
                            "salaryInfo": {
                                "type": "array",
                                "items": {
                                    "type": "string"
                                }
                            },
                            "postedAt": {
                                "type": "string"
                            },
                            "benefits": {
                                "type": "array",
                                "items": {
                                    "type": "string"
                                }
                            },
                            "descriptionHtml": {
                                "type": "string"
                            },
                            "applicantsCount": {
                                "type": "string"
                            },
                            "applyUrl": {
                                "type": "string"
                            },
                            "salary": {
                                "type": "string"
                            },
                            "descriptionText": {
                                "type": "string"
                            },
                            "seniorityLevel": {
                                "type": "string"
                            },
                            "employmentType": {
                                "type": "string"
                            },
                            "jobFunction": {
                                "type": "string"
                            },
                            "industries": {
                                "type": "string"
                            },
                            "inputUrl": {
                                "type": "string"
                            },
                            "companyAddress": {
                                "type": "object",
                                "properties": {
                                    "type": {
                                        "type": "string"
                                    },
                                    "streetAddress": {
                                        "type": "string"
                                    },
                                    "addressLocality": {
                                        "type": "string"
                                    },
                                    "addressRegion": {
                                        "type": "string"
                                    },
                                    "postalCode": {
                                        "type": "string"
                                    },
                                    "addressCountry": {
                                        "type": "string"
                                    }
                                },
                                "required": [
                                    "addressCountry",
                                    "addressLocality",
                                    "postalCode",
                                    "streetAddress",
                                    "type"
                                ]
                            },
                            "companyWebsite": {
                                "type": "string"
                            },
                            "companySlogan": {
                                "type": "string"
                            },
                            "companyDescription": {
                                "type": "string"
                            },
                            "companyEmployeesCount": {
                                "type": "integer"
                            }
                        },
                        "required": [
                            "applicantsCount",
                            "applyUrl",
                            "benefits",
                            "companyAddress",
                            "companyDescription",
                            "companyEmployeesCount",
                            "companyLinkedinUrl",
                            "companyLogo",
                            "companyName",
                            "companySlogan",
                            "companyWebsite",
                            "descriptionHtml",
                            "descriptionText",
                            "employmentType",
                            "id",
                            "industries",
                            "inputUrl",
                            "jobFunction",
                            "link",
                            "location",
                            "postedAt",
                            "refId",
                            "salary",
                            "salaryInfo",
                            "seniorityLevel",
                            "title",
                            "trackingId"
                        ]
                    }
                },
                "required": [
                    "fits",
                    "job"
                ]
            },
            include_sample_schema: true
        },
        testing_criteria: [{
            type: "string_check",
            name: 'Job Vacancy Evaluation',
            operation: "eq",
            input: '{{ sample.output_text }}',
            reference: '{{ item.fits }}'
        }]
    })).id;
}

const jobEvalRun = await openai.evals.runs.create(jobEvalId, {
    name: 'Job Vacancy Evaluation',
    data_source: {
        type: 'responses',
        model: 'gpt-5-nano',
        input_messages: {
            type: 'template',
            template: [
                {
                    role: 'developer', content: instructions
                },
                {
                    role: 'user', content: `This is personal information about me: ${personal} Evaluate the following job vacancy: {{ item.job }}`
                }
            ]
        },
        source: {
            type: 'file_id',
            id: testData.id
        }
    }
});

let jobEvalRunResponse;
do {
    jobEvalRunResponse = await openai.evals.runs.retrieve(jobEvalRun.id, {
        eval_id: jobEvalId
    });
    console.log(`Job vacancy filter evaluation run status: ${jobEvalRunResponse.status}`);
} while (jobEvalRunResponse.status === 'queued' || jobEvalRunResponse.status === 'in_progress');
console.log('Job vacancy filter evaluation run finished:', jobEvalRunResponse.result_counts);
console.log(jobEvalRunResponse.result_counts.passed / jobEvalRunResponse.result_counts.total * 100 + '% passed');
console.log(`Visit https://platform.openai.com/evaluations/${jobEvalId}/data?run_id=${jobEvalRun.id} for more information`);
