import z from 'zod';

const ZParagraphElement = z.object({
    startIndex: z.number().int().optional(),
    endIndex: z.number().int().optional(),
    textRun: z.object({
        content: z.string(),
        textStyle: z.record(z.any()).optional(),
    }).passthrough().optional(),
    autoText: z.record(z.any()).optional(),
    pageBreak: z.record(z.any()).optional(),
    columnBreak: z.record(z.any()).optional(),
    equation: z.record(z.any()).optional(),
    inlineObjectElement: z.record(z.any()).optional(),
}).passthrough();

const ZParagraph = z.object({
    elements: z.array(ZParagraphElement),
    paragraphStyle: z.record(z.any()).optional(),
    bullet: z.record(z.any()).optional(),
}).passthrough();

const ZStructuralElement = z.object({
    startIndex: z.number().int().optional(),
    endIndex: z.number().int().optional(),
    paragraph: ZParagraph.optional(),
    sectionBreak: z.record(z.any()).optional(),
    table: z.record(z.any()).optional(),
    tableOfContents: z.record(z.any()).optional(),
}).passthrough();

const ZBody = z.object({
    content: z.array(ZStructuralElement),
}).passthrough();

const ZTab = z.object({
    tabProperties: z.object({
        tabId: z.string().optional(),
        title: z.string().optional(),
        index: z.number().int().optional(),
    }).passthrough(),
    childTabs: z.array(z.string()).optional(),
    documentTab: z.object({
        body: ZBody.optional(),
    }).passthrough(),
}).passthrough();

const ZDocumentBase = z.object({
    title: z.string(),
    documentId: z.string(),
    revisionId: z.string().optional(),
    suggestionsViewMode: z.string().optional(),
    namedStyles: z.record(z.any()).optional(),
    documentStyle: z.record(z.any()).optional(),
    tabs: z.array(ZTab).optional(),
    body: ZBody.optional(),
}).passthrough();

export const ZPostalAddress = z.object({
    type: z.string().optional(),
    streetAddress: z.string().optional(),
    addressLocality: z.string().optional(),
    addressRegion: z.string().optional(),
    postalCode: z.string().optional(),
    addressCountry: z.string().optional(),
});

export const ZJob = z.object({
    id: z.string(),
    trackingId: z.string(),
    refId: z.string(),
    link: z.string(),
    title: z.string(),
    companyName: z.string(),
    companyLinkedinUrl: z.string(),
    companyLogo: z.string(),
    companyEmployeesCount: z.number(),
    location: z.string(),
    postedAt: z.string(),
    salaryInfo: z.array(z.string()),
    salary: z.string(),
    benefits: z.array(z.string()),
    descriptionHtml: z.string(),
    applicantsCount: z.union([z.number(), z.string()]),
    applyUrl: z.string(),
    descriptionText: z.string(),
    seniorityLevel: z.string(),
    employmentType: z.string(),
    jobFunction: z.string(),
    industries: z.string(),
    inputUrl: z.string(),
    companyAddress: ZPostalAddress,
    companyWebsite: z.string(),
    companySlogan: z.string(),
    companyDescription: z.string(),
});

export const GOOGLE_OUTPUT_SCHEMA = {
    uri: z.string().url(),
    document: ZDocumentBase.refine(doc => !!doc.tabs || !!doc.body, { message: 'document must include tabs or body' }),
};

export const GOOGLE_INPUT_SCHEMA = z.object({
    documentId: z.string()
});