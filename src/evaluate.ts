import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { promptBuilder, safeCall } from "./helpers.js";

type PersonalInformation = {
    contact: {
        name: string;
        email: string;
        phone: string;
        portfolio_urls: string[]
    };
    eligibility: {
        work_authorization: {
            region: string;
            status: string
        }[];
        security_clearance: string | null;
        relocation: {
            willing: boolean;
            regions: string[]
        };
        remote: {
            willing: boolean;
            time_zone: string
        };
        availability: {
            notice_period_days: number
        };
        work_schedule_constraints: {
            weekends: boolean;
            nights: boolean
        }
    };
    constraints: {
        salary_min: {
            currency: string;
            amount: number
        };
        locations_allowed: string[];
        company_blacklist: string[];
        industries_disallowed: string[];
    };
    preferences: {
        roles: {
            title: string;
            weight: number
        }[];
        seniority: {
            level: string;
            weight: number
        }[];
        company_size: {
            range: string;
            weight: number
        }[];
        work_mode: {
            mode: string;
            weight: number
        }[];
        industries: 'any' | string[];
    };
    skills: {
        skill_id: string;
        name: string;
        category: string;
        level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
        years: number;
        last_used: string;
        primary: boolean
    }[];
    experience_summary: {
        years_total: number;
        domains: string[];
        recent_titles: string[];
        achievements: {
            tag: string;
            brief: string
        }[]
    };
    education: any[];
    certifications: {
        name: string;
        issued: string;
        expires: string | null
    }[];
    languages_spoken: {
        language: string;
        level: string
    }[];
    exclusions: {
        avoid_roles: {
            title: string;
            hard: boolean
        }[];
        avoid_technlogies: {
            name: string;
            hard: boolean
        }[];
        avoid_industries: {
            name: string;
            hard: boolean
        }[]
    };
    scoring_settings: {
        recency_decay: {
            half_life_months: number
        };
        skill_match: {
            primary_weight: number;
            secondary_weight: number
        };
        location_distance_km_max: number;
        salary_tolerance_percent: number
    }
};

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
    console.log('Error: ', evalRun.error);
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
