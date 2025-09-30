# applicationAgent

Automated multi‑agent pipeline for sourcing LinkedIn job vacancies, filtering for fit, and producing high‑quality, self‑critiqued HTML application letters.

---

## Why This Exists

Manual tailoring of job applications is slow, repetitive, and noisy. applicationAgent automates the boring 90% while keeping humans in the loop for review. It combines structured scraping, schema‑validated parsing, controlled prompt assembly, and iterative critique for higher quality drafts with less hallucination and drift.

## High‑Level Overview

1. Scrape LinkedIn job pages/searches via Apify (caches by last scrape timestamp)
2. Parse + Zod‑validate raw items into strongly typed `Job` objects
3. Filter jobs using an LLM “fit” discriminator prompt
4. For accepted jobs, assemble a writer prompt with curated examples
5. Generate HTML letters (German or English depending on job language cues)
6. (Planned / currently disabled in live run) Evaluate drafts against GOOD/BAD exemplars for iterative refinement
7. Persist final HTML to `data/applications/<jobId>.html`


## Architecture Snapshot

| Layer | Responsibility | Key Files |
|-------|----------------|-----------|
| Scrape | Fetch LinkedIn jobs through Apify actor | `src/client.ts` (scrape orchestration) |
| Parse & Validate | Convert raw JSON to `Job` schema | `src/client.ts`, `src/schemas.ts` |
| Filter | LLM decides keep / drop | `src/filter.ts`, `instructions/filter.txt` |
| Prompt Assembly | Inject examples + dynamic vars | `src/instructions/promptBuilder.ts` |
| Writer | Produce HTML letter(s) | `src/writer.ts` |
| Evaluator | Judge quality (`good|bad`) | `src/evaluate.ts`, `instructions/evaluator.txt` |
| Persistence | Save final artifacts | `data/applications/*.html` |
| Errors | Domain‑specific failures | `src/errors.ts` |

## Data Flow (Simplified)

```text
Apify -> raw listings -> parse(Zod) -> Job[] -> filter LLM -> accepted subset
  -> promptBuilder (examples + personal info + subset) -> writer LLM -> draft HTML[]
    -> evaluator loop (good|bad) -> final HTML[] -> filesystem persistence
```

## Directory Map

```
data/
  scrapeUrls.txt            # Input: one LinkedIn search or job URL per line
  resumeInspiration.txt     # Personal profile text (collapsed to single line)
  applications/
    goodResponses/          # Curated GOOD HTML examples
    badResponses/           # Curated BAD HTML examples
    <jobId>.html            # Generated application letters
instructions/
  filter.txt
  writer.txt
  evaluator.txt
src/
  client.ts                 # ApplicationAssistant orchestrator
  writer.ts                 # Writer agent logic
  filter.ts                 # Filtering agent logic
  evaluate.ts               # Eval harness (job fit prototype)
  errors.ts                 # Custom error classes
  schemas.ts                # Zod schemas
  types.d.ts
  instructions/promptBuilder.ts
build/                      # Compiled JS output (tsc)
secrets/
  apify_token               # Apify API token (file contents only)
jobVacancyTestData.jsonl    # Test dataset for eval harness (if present)
```

## Environment & Configuration

Required environment + files:

| Purpose | Variable / Path | Notes |
|---------|-----------------|-------|
| OpenAI auth | `OPENAI_API_KEY` | Export in shell (no quotes) |
| Apify auth | `secrets/apify_token` | File containing only the token |
| Input sources | `data/scrapeUrls.txt` | One URL per line |
| Personal info | `data/personalInformation.json` | Personal information |
| Examples | `data/applications/examples` | Contains text files with examples for letters written by the user |

Assumptions:
- Node 18+
- Internet access for scraping & OpenAI

## Install & Bootstrap

```sh
npm install
```

Minimal one‑shot setup:

```sh
export OPENAI_API_KEY=sk-...               # or add to your shell profile
echo "YOUR_APIFY_TOKEN" > secrets/apify_token
echo "https://www.linkedin.com/jobs/search/?currentJobId=123" > data/scrapeUrls.txt
echo "Kurzprofil, Skills, Stack, Motivation ..." > data/resumeInspiration.txt
mkdir -p data/applications/{goodResponses,badResponses}
npm install
npm run start
```

## Scripts

Declared in `package.json`:

```jsonc
"start": "rm -rf build && tsc && chmod 755 build/*.js && node build/client.js",
"eval": "rm -rf build && tsc && chmod 755 build/*.js && node build/evaluate.js"
```

## Running the Full Pipeline

```sh
npm run start
```

What it does:
1. Cleans & recompiles TypeScript
2. Loads / validates required input files
3. Scrapes (or reuses fresh cache) via Apify
4. Parses -> Zod validates -> `Job[]`
5. Filters jobs (LLM) using `instructions/filter.txt`
6. Builds writer prompt (GOOD/BAD examples + personal info)
7. Generates draft HTML letter(s)
8. Evaluates each via evaluator prompt until `good` or retry cap
9. Writes final HTML to `data/applications/`

## Evaluation Harness (Prototype)

```sh
npm run eval
```

Performs:
- Upload / register `jobVacancyTestData.jsonl`
- (Re)create eval: “Job Vacancy Evaluation”
- Compare model boolean outputs vs ground truth

Planned extensions: precision/recall & confusion matrix summarization.

## Prompt Assembly & Placeholders

`promptBuilder` merges static instruction templates with dynamic tokens:

| Placeholder | Source | Description |
|-------------|--------|-------------|
| `{{GOOD_APPLICATIONS}}` | local FS | Concatenated GOOD examples |
| `{{BAD_APPLICATIONS}}` | local FS | Concatenated BAD examples |
| `{{RECOMMENDED_PROMPT_PREFIX}}` | model guidance | Safety / style prelude |
| `{{PERSONAL_INFO}}` | `resumeInspiration.txt` | Personal profile text |
| `{{JOBS_SUBSET}}` | filtered jobs | JSON snippet of target jobs |

Rules:
- Extra placeholders must be UPPER_SNAKE wrapped in `{{ }}`
- No collision with reserved tokens
- Empty values rejected (trim check)

## Quality Loop Logic

> NOTE: The evaluator comparison loop (GOOD/BAD exemplar based) is presently **disabled** in the active agent execution due to instability in consistent `good|bad` judgments. The code and instructions remain in the repository and are intended to be re‑enabled after improvements (see Roadmap). The generated letters currently represent first‑pass drafts without automatic iterative refinement.

Pseudo:

```ts
while (retries < MAX && status !== 'good') {
  draft = write()
  verdict = evaluate(draft) // must be 'good' | 'bad'
  if (verdict === 'bad') refine context & retry
}
if (status !== 'good') throw InvalidWriterOutputError
```

## Error Reference

| Error | Thrown When | File |
|-------|-------------|------|
| `ParsingAfterScrapeError` | Zod parse failure after scraping | `src/errors.ts` |
| `InvalidEvaluationOutputError` | Evaluator not `good|bad` | `src/errors.ts` |
| `InvalidWriterOutputError` | Final writer output invalid shape | `src/errors.ts` |

## Extending / Customizing

- Improve filtering strictness: edit `instructions/filter.txt`
- Add richer evaluation rubric: refine `instructions/evaluator.txt`
- Curate more nuanced GOOD/BAD samples for better grounding
- Adjust retry caps inside writer loop (`writeApplications` in `src/client.ts`)
- Introduce language preference flag (planned)

## Development Notes

- TypeScript targets Node module resolution; ESM build; output in `build/`
- Keep runtime imports extension‑less (ESM ok)
- Consider adding Vitest/Jest for unit tests (see Roadmap)

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| No letters generated | Filter rejected all | Inspect `filter.txt`, add broader criteria |
| Error: parse failure | Schema drift in scrape output | Update `schemas.ts` or Apify actor params |
| Evaluator never returns `good` | Over‑strict rubric or weak examples | Add GOOD examples / relax evaluator wording |
| Empty placeholders | Missing input files | Recreate `resumeInspiration.txt` / examples dirs |

## Roadmap (Short List)

- [ ] Configurable preferred application language
- [ ] CLI flags (e.g. `--limit`, `--language`)
 - [ ] Re‑enable stable evaluator refinement loop (GOOD/BAD exemplar comparison)

## License & Disclaimer

UNLICENSED – see `package.json`.

Outputs are machine‑generated drafts. Always review before sending to employers.

---

Contributions (issues / PRs) welcome for documentation, tests, and evaluation metrics.

---

Made with intent to reduce repetitive cognitive load while maintaining authenticity.
