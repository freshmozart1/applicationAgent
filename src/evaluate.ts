import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { promptBuilder } from "./helpers.js";
import { JobEvalSchema } from "./schemas.js";

const openai = new OpenAI();
const root = process.cwd();
const testDataPath = path.join(root, "data/filterTestData.json");
const evalName = "Job Vacancy Evaluation";
const chunkSize = 16;
const chunks: typeof testData[] = [];
const readJSON = <T>(p: string, options: { encoding: BufferEncoding, flag?: string | undefined } | BufferEncoding = 'utf8') => JSON.parse(fs.readFileSync(p, options)) as T;
let personal: PersonalInformation;
try {
    personal = readJSON<PersonalInformation>(path.join(root, "data/personalInformation.json"));
} catch (e) {
    throw new Error("Failed to load personalInformation.json: " + e);
}

if (!fs.existsSync(testDataPath)) throw new Error("Test data file not found");
const testData = readJSON<{ fits: boolean; job: Job }[]>(testDataPath);
if (!Array.isArray(testData)) throw new Error("Test data is not an array");
testData.forEach((item, i) => {
    const r = JobEvalSchema.safeParse(item);
    if (!r.success) throw new Error("Invalid test data item " + i + ": " + JSON.stringify(r.error.issues));
});

for (const f of (await openai.files.list({ purpose: "evals" })).data) if (/^jobEval.*\.jsonl$/.test(f.filename)) await openai.files.delete(f.id);
const evalId =
    (await openai.evals.list()).data.find(e => e.name === evalName)?.id ??
    (await openai.evals.create({
        name: evalName,
        data_source_config: { type: "custom", item_schema: JobEvalSchema.shape, include_sample_schema: true },
        testing_criteria: [
            {
                type: "string_check",
                name: evalName,
                operation: "eq",
                input: "{{ sample.output_text }}",
                reference: "{{ item.fits }}"
            }
        ]
    })).id;

for (let i = 0; i < testData.length; i += chunkSize) chunks.push(testData.slice(i, i + chunkSize));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

for (const [i, fileId] of (
    await Promise.all(chunks.map(async (chunk, i) => {
        const tmp = path.join(root, `jobEval${i}.jsonl`);
        fs.writeFileSync(tmp, chunk.map(item => `{"item":${JSON.stringify(item)}}`).join("\n"));
        try {
            const f = await openai.files.create({ file: fs.createReadStream(tmp), purpose: "evals" });
            return f.id;
        } catch (e) {
            console.error("Upload failed:", e);
        } finally {
            try {
                fs.unlinkSync(tmp);
            } catch { }
        }
    }))
).filter((x): x is string => !!x).entries()) {
    try {
        const runId = (
            await openai.evals.runs.create(evalId, {
                name: `${evalName} Run ${i + 1}`,
                data_source: {
                    type: "responses",
                    model: "gpt-5-nano",
                    input_messages: {
                        type: "template",
                        template: [
                            {
                                role: "system",
                                content: promptBuilder("filter", [
                                    ["{{PERSONAL_INFO}}", JSON.stringify(personal)],
                                    ["{{JOB}}", "{{item.job}}"]
                                ])
                            },
                            { role: "user", content: "Evaluate the following job vacancy: {{item.job}}" }
                        ]
                    },
                    source: { type: "file_id", id: fileId }
                }
            })
        ).id;
        while (true) {
            try {
                const { status } = await openai.evals.runs.retrieve(runId, { eval_id: evalId });
                if (status === "completed" || status === "failed") {
                    console.log("Run", runId, "finished:", status);
                    break;
                }
                console.log("Run", runId, "status:", status);
            } catch (e) {
                console.error("Polling error:", e);
            }
            await sleep(3000);
        }
    } catch (e) {
        console.error("Run creation failed for file:", fileId, e);
    }
}