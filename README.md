# applicationAgent

AI agent workflow that:
1. Scrapes LinkedIn job vacancies via Apify.
2. Filters jobs with an OpenAI evaluation agent.
3. Generates tailored HTML application letters (in German or English) per selected job.
4. Iteratively self‑critiques letters using an evaluator tool until quality is “good”.
5. Saves the final letters to `data/applications`.

## Features

- Strong schema validation with Zod (`Job` schema in [`src/client.ts`](src/client.ts)).
- Prompt assembly with dynamic examples using [`promptBuilder`](src/instructions/promptBuilder.ts).
- Multi‑agent workflow orchestrated by the `ApplicationAssistant` class in [`src/client.ts`](src/client.ts).
- Automatic retry + evaluation loop for generated letters.
- Local quality examples sourced from:
  - `data/applications/goodResponses`
  - `data/applications/badResponses`
- Evals pipeline for job fit prototype in [`src/evaluate.ts`](src/evaluate.ts).
- Custom errors: [`ParsingAfterScrapeError`](src/errors.ts), [`InvalidEvaluationOutputError`](src/errors.ts), [`InvalidWriterOutputError`](src/errors.ts).

## Core Classes / Symbols

- `ApplicationAssistant` (main workflow) in [`src/client.ts`](src/client.ts)
- `promptBuilder` in [`src/instructions/promptBuilder.ts`](src/instructions/promptBuilder.ts)
- Errors: [`ParsingAfterScrapeError`](src/errors.ts), [`InvalidEvaluationOutputError`](src/errors.ts), [`InvalidWriterOutputError`](src/errors.ts)

## Directory Structure

```
data/
  resumeInspiration.txt
  scrapeUrls.txt
  applications/
    goodResponses/   # curated GOOD html examples
    badResponses/    # curated BAD html examples
    *.html           # generated outputs
instructions/
  filter.txt
  writer.txt
  evaluator.txt
src/
  client.ts
  evaluate.ts
  errors.ts
  instructions/promptBuilder.ts
build/              # compiled JS (tsc output)
secrets/
  apify_token
jobVacancyTestData.jsonl
```

## Prerequisites

- Node 18+
- OpenAI API key in environment: `OPENAI_API_KEY`
- Apify token stored in `secrets/apify_token`
- Populate:
  - `data/scrapeUrls.txt` (one LinkedIn job search / job URL per line)
  - `data/resumeInspiration.txt` (personal profile; long lines are ok—newlines are stripped)

## Install

```sh
npm install
```

## Run (full pipeline)

Build + run:

```sh
npm run start
```

What happens:
- Validates required paths.
- Scrapes or reuses a recent scrape (rescrapes if last scrape older than 24h).
- Parses & validates jobs (throws [`ParsingAfterScrapeError`](src/errors.ts) if schema mismatch).
- Filters jobs using the “filter” prompt (see [`instructions/filter.txt`](instructions/filter.txt)).
- Generates letters; each letter is evaluated via the evaluator tool until “good” or throws [`InvalidWriterOutputError`](src/errors.ts) if final output is malformed.
- Saves each letter as `<jobId>.html` in `data/applications`.

## Evals (job fit prototype)

Runs the evaluation harness in [`src/evaluate.ts`](src/evaluate.ts):

```sh
npm run eval
```

It:
- Uploads `jobVacancyTestData.jsonl`
- (Re)creates an eval named “Job Vacancy Evaluation”
- Compares model responses (`true` / `false`) against ground truth in the JSONL.

## Prompts & Placeholder Expansion

`promptBuilder`:
- Loads base instruction files from `instructions/`
- Injects:
  - `{{GOOD_APPLICATIONS}}` from `goodResponses`
  - `{{BAD_APPLICATIONS}}` from `badResponses`
  - OpenAI recommended prefix: `{{RECOMMENDED_PROMPT_PREFIX}}`
  - Extra placeholders (e.g. `{{PERSONAL_INFO}}`, `{{JOBS_SUBSET}}`) for the writer

Validation rules (see [`promptBuilder`](src/instructions/promptBuilder.ts)):
- Additional placeholders must match `{{UPPER_CASE}}` style
- No collisions with reserved placeholders
- Values must be non‑empty (trimmed)

## Output Quality Loop

Writer agent (see `writeApplications()` in [`src/client.ts`](src/client.ts)):
1. Draft letter(s)
2. Calls evaluator tool (`#evaluation`)
3. If response not exactly `good` / `bad`, throws [`InvalidEvaluationOutputError`](src/errors.ts)
4. On `bad`, rewrites; repeats (retry capped)
5. Returns a JSON array of final HTML strings (validated)

## Error Handling

- [`ParsingAfterScrapeError`](src/errors.ts): Zod parse failure after scrape
- [`InvalidEvaluationOutputError`](src/errors.ts): Evaluator returned something other than `good|bad`
- [`InvalidWriterOutputError`](src/errors.ts): Writer final output not valid JSON array / length mismatch

## Customization

- Tune filtering logic: adjust filter instructions in [`instructions/filter.txt`](instructions/filter.txt)
- Improve examples: curate HTML samples in `goodResponses` / `badResponses`
- Adjust max retries (constant inside `writeApplications` in [`src/client.ts`](src/client.ts))

## Environment & Module Format

- TypeScript compiled with `module: Node16` (ESM) per [`tsconfig.json`](tsconfig.json)
- Package declares `"type": "module"` in [`package.json`](package.json)

## Scripts (from [`package.json`](package.json))

```json
"start": "rm -rf build && tsc && chmod 755 build/*.js && node build/client.js",
"eval": "rm -rf build && tsc && chmod 755 build/*.js && node build/evaluate.js"
```

## Minimal Setup Checklist

```sh
export OPENAI_API_KEY=sk-...
echo "YOUR_APIFY_TOKEN" > secrets/apify_token
echo "https://www.linkedin.com/jobs/search/?currentJobId=..." > data/scrapeUrls.txt
echo "Kurzprofil, Skills, Stack, Motivation ..." > data/resumeInspiration.txt
mkdir -p data/applications/goodResponses data/applications/badResponses
npm install
npm run start
```

## Generated Docs

Static TypeDoc output in [`docs/`](docs/index.html).

## License

UNLICENSED (see [`package.json`](package.json)).

## Disclaimer

Use responsibly. Generated letters should be reviewed before sending.

## TODO Ideas

- Persist scrape cache metadata
- Add unit tests
- Expand eval metrics (precision / recall summary)
- Configurable language preference

---