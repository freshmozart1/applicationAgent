import * as zod3 from 'zod';
import * as zod4 from 'zod-v4';
/**
 * Zod schema for a job vacancy as returned by the LinkedIn jobs scraper.
 */
const jobAddress = (z: any) =>
    z.object({
        type: z.string().optional().nullable(),
        streetAddress: z.string().optional().nullable(),
        addressLocality: z.string().optional().nullable(),
        addressRegion: z.string().optional().nullable(),
        postalCode: z.string().optional().nullable(),
        addressCountry: z.string().optional().nullable(),
    });

const jobSchema = (z: any) =>
    z.object({
        id: z.string(),
        trackingId: z.string(),
        refId: z.string(),
        link: z.string(),
        title: z.string(),
        companyName: z.string(),
        companyLinkedinUrl: z.string(),
        companyLogo: z.string(),
        companyEmployeesCount: z.optional(z.number()),
        location: z.string(),
        postedAt: z.string(),
        salaryInfo: z.array(z.string()),
        salary: z.string(),
        benefits: z.array(z.string()),
        descriptionHtml: z.string(),
        applicantsCount: z.union([z.number(), z.string()]),
        applyUrl: z.string(),
        descriptionText: z.string(),
        seniorityLevel: z.optional(z.string()),
        employmentType: z.string(),
        jobFunction: z.optional(z.string()),
        industries: z.optional(z.string()),
        inputUrl: z.string(),
        companyAddress: z.optional(jobAddress(z)),
        companyWebsite: z.optional(z.string()),
        companySlogan: z.optional(z.string()).nullable(),
        companyDescription: z.optional(z.string())
    });

export const ZJob = jobSchema(zod3);
export const JJob = zod4.toJSONSchema(jobSchema(zod4));

export const JobEvalSchema = zod4.object({
    fits: zod4.literal("true").or(zod4.literal("false")),
    job: jobSchema(zod4)
});

export const EvaluationToolSchema = zod3.object({
    letter: zod3.string()
})