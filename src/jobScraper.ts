import path from "path";
import fs from "fs";
import z from "zod";
import { ApifyClient } from "apify-client";
import { Db, MongoClient } from "mongodb";
import { ZJob } from './schemas.js';
import { ParsingAfterScrapeError } from "./errors.js";

export class JobScraper {
    apifyClient: ApifyClient;
    lastScrapeIdPath: string;
    lastScrapeId: string | null;
    mongoClient: MongoClient;
    db: Db;

    async scrapeJobs(): Promise<Job[]> {
        try {
            if ((this.lastScrapeId && fs.statSync(this.lastScrapeIdPath).ctimeMs < (Date.now() - 24 * 60 * 60 * 1000)) || !this.lastScrapeId) {
                await this.mongoClient.connect();
                await this.db.command({ ping: 1 });
                const urls = await this.db.collection<{ url: string }>('scrapeUrls').find().toArray().then(docs => docs.map(doc => doc.url));
                if (urls.length === 0) throw new Error("No URLs found in scrapeUrls collection");
                console.log('Last scrape is older than a day, performing a new scrape.');
                await this.apifyClient.actor('curious_coder/linkedin-jobs-scraper').call({
                    urls,
                    count: 100
                }).then(scrape => {
                    this.lastScrapeId = scrape.defaultDatasetId;
                    fs.writeFileSync(this.lastScrapeIdPath, this.lastScrapeId);
                })
            } else console.log('Using last scrape data.');
            const parsedJobs = await z.array(ZJob).safeParseAsync(await this.apifyClient.dataset<Job>(this.lastScrapeId!).listItems().then(res => res.items));
            if (!parsedJobs.success) throw new ParsingAfterScrapeError(parsedJobs.error);
            return parsedJobs.data;
        } finally {
            await this.mongoClient.close();
        }
    };

    constructor(dataDir: string) {
        if (!process.env.APIFY_TOKEN) throw new Error("APIFY_TOKEN is not set in environment variables");
        this.apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });
        this.lastScrapeIdPath = path.join(dataDir, "lastScrapeId");
        this.lastScrapeId = fs.existsSync(this.lastScrapeIdPath) ? fs.readFileSync(this.lastScrapeIdPath, "utf-8") : null;
        this.mongoClient = new MongoClient(process.env.MONGODB_CONNECTION_STRING!);
        this.db = this.mongoClient.db('applicationAgentDB');
    }
}