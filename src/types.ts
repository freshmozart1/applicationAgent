// Types derived from data/jobs.json sample
export interface PostalAddress {
    type?: 'PostalAddress' | string;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
}

export interface Job {
    // Core identifiers
    id: string;
    trackingId: string;
    refId: string;

    // Links and titles
    link: string;
    title: string;

    // Company basics
    companyName: string;
    companyLinkedinUrl: string;
    companyLogo: string;
    companyEmployeesCount: number;

    // Location & timing
    location: string;
    postedAt: string; // ISO-like date string in data

    // Compensation & perks
    salaryInfo: string[];
    salary: string;
    benefits: string[];

    // Optional extended fields
    descriptionHtml: string;
    applicantsCount: number | string;
    applyUrl: string;
    descriptionText: string;
    seniorityLevel: string;
    employmentType: string;
    jobFunction: string;
    industries: string;
    inputUrl: string;
    companyAddress: PostalAddress;
    companyWebsite: string;
    companySlogan: string;
    companyDescription: string;
}

export type Jobs = Job[];

