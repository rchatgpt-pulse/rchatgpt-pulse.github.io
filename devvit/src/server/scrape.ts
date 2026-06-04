/**
 * Daily scrape job for r/ChatGPT.
 *
 * Reads new+top via the Devvit Reddit client, dedups against a Redis hash,
 * caps at DAILY_POST_CAP, builds a JSONL of records matching live/scraper.py's
 * schema, and PUTs it to the GitHub Contents API as data/raw_posts/<date>.jsonl
 * on jessica-dai/r-chatgpt:main. Triggered manually via /internal/scrape or
 * scheduled daily by scheduler.runJob registered at install time.
 */

import { Buffer } from "node:buffer";

import { reddit, redis, settings } from "@devvit/web/server";

const SUBREDDIT = "ChatGPT";
const WINDOW_HOURS = 30;
const DAILY_POST_CAP = 500;
const GITHUB_OWNER = "jessica-dai";
const GITHUB_REPO = "r-chatgpt";
const TARGET_BRANCH = "main";
const SEEN_IDS_KEY = "seen_ids";

export interface ScrapeRecord {
  id: string;
  title: string;
  selftext: string;
  created_utc: number;
  score_updated: number;
  num_comments_updated: number;
  permalink: string;
  url: string;
  author: string;
  is_self: boolean;
}

export interface ScrapeSummary {
  date: string;
  kept: number;
  skipped_seen: number;
  skipped_invalid: number;
  committed_path: string;
}

export async function runScrape(): Promise<ScrapeSummary> {
  const cutoffSec = Math.floor(Date.now() / 1000) - WINDOW_HOURS * 3600;
  const today = new Date().toISOString().slice(0, 10);

  // Load all seen IDs once, check in memory (saves up to ~2000 round-trips).
  const seen = new Set<string>(await redis.hKeys(SEEN_IDS_KEY));
  const seenInPass = new Set<string>();

  let nSkippedSeen = 0;
  let nSkippedInvalid = 0;
  const records: ScrapeRecord[] = [];

  // Pass 1: 'new' is reverse-chronological, so we break on first too-old.
  for await (const post of reddit.getNewPosts({
    subredditName: SUBREDDIT,
    limit: 1000,
  })) {
    if (records.length >= DAILY_POST_CAP) break;
    const created = Math.floor(post.createdAt.getTime() / 1000);
    if (created < cutoffSec) break;
    if (seenInPass.has(post.id)) continue;
    seenInPass.add(post.id);
    if (seen.has(post.id)) {
      nSkippedSeen++;
      continue;
    }
    if (!isValid(post)) {
      nSkippedInvalid++;
      continue;
    }
    records.push(toRecord(post));
  }

  // Pass 2: 'top' is by score, not time. Filter rather than break.
  for await (const post of reddit.getTopPosts({
    subredditName: SUBREDDIT,
    timeframe: "day",
    limit: 1000,
  })) {
    if (records.length >= DAILY_POST_CAP) break;
    if (seenInPass.has(post.id)) continue;
    seenInPass.add(post.id);
    const created = Math.floor(post.createdAt.getTime() / 1000);
    if (created < cutoffSec) continue;
    if (seen.has(post.id)) {
      nSkippedSeen++;
      continue;
    }
    if (!isValid(post)) {
      nSkippedInvalid++;
      continue;
    }
    records.push(toRecord(post));
  }

  console.log(
    `[scrape ${today}] kept=${records.length} skipped_seen=${nSkippedSeen} skipped_invalid=${nSkippedInvalid}`,
  );

  const path = await commitJsonl(today, records);

  // Mark seen only after a successful commit; a failed commit can be retried.
  if (records.length > 0) {
    const updates: Record<string, string> = {};
    for (const r of records) updates[r.id] = today;
    await redis.hSet(SEEN_IDS_KEY, updates);
  }

  return {
    date: today,
    kept: records.length,
    skipped_seen: nSkippedSeen,
    skipped_invalid: nSkippedInvalid,
    committed_path: path,
  };
}

export async function clearSeenIds(): Promise<number> {
  const before = (await redis.hKeys(SEEN_IDS_KEY)).length;
  await redis.del(SEEN_IDS_KEY);
  console.log(`[clearSeenIds] removed ${before} entries from ${SEEN_IDS_KEY}`);
  return before;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isValid(post: any): boolean {
  if (post.removedByCategory) return false;
  const body = post.body ?? "";
  return body !== "[removed]" && body !== "[deleted]";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecord(post: any): ScrapeRecord {
  return {
    id: post.id,
    title: post.title ?? "",
    selftext: post.body ?? "",
    created_utc: Math.floor(post.createdAt.getTime() / 1000),
    score_updated: Number(post.score ?? 0),
    num_comments_updated: Number(post.numberOfComments ?? 0),
    permalink: post.permalink ?? "",
    url: post.url ?? "",
    author: String(post.authorName ?? ""),
    is_self: Boolean(post.body),
  };
}

async function commitJsonl(
  today: string,
  records: ScrapeRecord[],
): Promise<string> {
  const path = `data/raw_posts/${today}.jsonl`;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  const pat = await settings.get<string>("github_pat");
  if (!pat) {
    throw new Error(
      "github_pat secret is not set; run `npx devvit settings set github_pat`",
    );
  }

  // Devvit's fetch wrapper throws on non-2xx (unlike Web Fetch). 404 is the
  // expected first-day case; anything else is a real failure we want to see.
  let sha: string | undefined;
  try {
    const head = await fetch(`${url}?ref=${TARGET_BRANCH}`, {
      headers: ghHeaders(pat),
    });
    if (head.ok) {
      const existing = (await head.json()) as { sha: string };
      sha = existing.sha;
    }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (!/404/.test(msg)) throw e;
  }

  const jsonl =
    records.map((r) => JSON.stringify(r)).join("\n") +
    (records.length ? "\n" : "");
  const body = JSON.stringify({
    message: `daily scrape ${today}: ${records.length} posts`,
    content: Buffer.from(jsonl, "utf-8").toString("base64"),
    branch: TARGET_BRANCH,
    sha,
  });

  const put = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(pat), "Content-Type": "application/json" },
    body,
  });
  if (!put.ok) {
    const txt = await put.text();
    throw new Error(`GitHub Contents PUT failed: ${put.status} ${txt}`);
  }
  console.log(`[scrape ${today}] committed ${path}`);
  return path;
}

function ghHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
