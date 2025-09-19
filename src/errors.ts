/**
 * This module defines custom error classes for the application.
 */
import z from "zod";
/**
 * This error is thrown when {@link https://zod.dev | Zod} cannot parse the jobs returned by the LinkedIn jobs scraper.
 */
export class ParsingAfterScrapeError extends Error {
    constructor(jobsError: z.ZodError<Job[]>) {
        super('Failed to parse jobs returned by the LinkedIn jobs scraper: ' + JSON.stringify(jobsError));
        this.name = 'ParsingAfterScrapeError';
    }
}

/**
 * This error is thrown when the evaluation output from the evaluator agent is not exactly "good" or "bad".
 */
export class InvalidEvaluationOutputError extends Error {
    constructor() {
        super('Evaluation output must be exactly "good" or "bad"');
        this.name = 'InvalidEvaluationOutputError';
    }
}

/**
 * This error is thrown when the writer agent does not return valid final output.
 */
export class InvalidWriterOutputError extends Error {
    constructor() {
        super('Writer did not return valid final output.');
        this.name = 'InvalidWriterOutputError';
    }
}

/**
 * This error is thrown when a single job subset is too large to be processed by the writer agent.
 */
export class SingleJobSubsetTooLargeError extends Error {
    constructor() {
        super(`Single job subset too large.`);
        this.name = 'SingleJobSubsetTooLargeError';
    }
}

export class InvalidFilterOutputError extends Error {
    constructor() {
        super('Filter did not return valid output.');
        this.name = 'InvalidFilterOutputError';
    }
}