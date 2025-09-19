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