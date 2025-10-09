type PostalAddress = {
    type?: 'PostalAddress' | string | null;
    streetAddress?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    postalCode?: string | null;
    addressCountry?: string | null;
};

type Job = {
    id: string;
    trackingId: string;
    refId: string;
    link: string;
    title: string;
    companyName: string;
    companyLinkedinUrl: string;
    companyLogo: string;
    companyEmployeesCount?: number | undefined;
    location: string;
    postedAt: string;
    salaryInfo: string[];
    salary: string;
    benefits: string[];
    descriptionHtml: string;
    applicantsCount: number | string;
    applyUrl: string;
    descriptionText: string;
    seniorityLevel?: string | undefined;
    employmentType: string;
    jobFunction?: string | undefined;
    industries?: string | undefined;
    inputUrl: string;
    companyAddress?: PostalAddress | undefined;
    companyWebsite?: string | undefined;
    companySlogan?: string | null | undefined;
    companyDescription?: string | undefined;
};

type StrippedJob = {
    title: string;
    companyName: string;
    location: string;
    descriptionText: string;
    salaryInfo: string[];
    salary: string;
    industries: string | undefined;
    employmentType: string;
    seniorityLevel: string | undefined;
    companySize: number | undefined;
};

type RetryOptions = {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    retryOn?: (info: {
        status: number | null;
        error: unknown;
        attempt: number;
    }) => boolean;
    onRetry?: (info: {
        attempt: number;
        delayMs: number;
        reason: string;
    }) => void;
    /**
     * Optional handler invoked when the error message contains 'request too large'.
     * Should perform domain-specific splitting and return combined result.
     */
    onRequestTooLarge?: () => Promise<any>;
};

type PersonalInformationContact = {
    name: string;
    email: string;
    phone: string;
    portfolio_urls: string[];
};

type PersonalInformationEligibility = {
    work_authorization: {
        region: string;
        status: string;
    }[];
    security_clearance: string | null;
    relocation: {
        willing: boolean;
        regions: string[];
    };
    remote: {
        willing: boolean;
        time_zone: string;
    };
    availability: {
        notice_period_days: number;
    };
    work_schedule_constraints: {
        weekends: boolean;
        nights: boolean;
    };
};

type PersonalInformationConstraints = {
    salary_min: {
        currency: string;
        amount: number;
    };
    locations_allowed: string[];
};

type PersonalInformationPreferences = {
    roles: string[];
    seniority: string[];
    company_size: string[];
    work_mode: {
        mode: string;
    }[];
    industries: string[];
};

type PersonalInformationSkill = {
    name: string;
    aliases: string[];
    category: string;
    level: string;
    years: number;
    last_used: string;
    primary: boolean;
};

type PersonalInformationExperience = {
    years_total: number;
    domains: string[];
    recent_titles: string[];
    achievements: {
        tag: string;
        brief: string;
    }[];
};

type PersonalInformationEducation = {
    degree: string;
    field: string;
    institution: string;
    graduation_year: number;
};

type PersonalInformationCertification = {
    name: string;
    issued: string;
    expires: string | null;
};

type PersonalInformationLanguageSpoken = {
    language: string;
    level: string;
};

type PersonalInformationExclusions = {
    avoid_roles: string[];
    avoid_technologies: string[];
    avoid_industries: string[];
    avoid_companies: string[];
};

type PersonalInformationMotivation = {
    topic: string;
    description: string;
    reason_lite: string;
};

type PersonalInformation = {
    contact: PersonalInformationContact,
    eligibility: PersonalInformationEligibility,
    constraints: PersonalInformationConstraints,
    preferences: PersonalInformationPreferences,
    skills: PersonalInformationSkill[],
    experience: PersonalInformationExperience,
    education: PersonalInformationEducation[],
    certifications: PersonalInformationCertification[],
    languages_spoken: PersonalInformationLanguageSpoken[],
    exclusions: PersonalInformationExclusions,
    motivations: PersonalInformationMotivation[]
};