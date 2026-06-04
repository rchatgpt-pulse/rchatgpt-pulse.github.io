import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis } from "@devvit/web/server";
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type DecrementRequest,
  type DecrementResponse,
  type IncrementRequest,
  type IncrementResponse,
  type InitResponse,
} from "../shared/api.ts";
import { once } from "node:events";
import { clearSeenIds, runScrape, type ScrapeSummary } from "./scrape.ts";

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;

  if (!url || url === "/") {
    writeJSON<ErrorResponse>(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  const endpoint = url as ApiEndpoint;

  let body: ApiResponse | UiResponse | ErrorResponse | ScrapeSummary;
  switch (endpoint) {
    case ApiEndpoint.Init:
      body = await onInit();
      break;
    case ApiEndpoint.Increment:
      body = await onIncrement(req);
      break;
    case ApiEndpoint.Decrement:
      body = await onDecrement(req);
      break;
    case ApiEndpoint.OnPostCreate:
      body = await onMenuNewPost();
      break;
    case ApiEndpoint.OnAppInstall:
      body = await onAppInstall();
      break;
    case ApiEndpoint.Scrape:
      body = await runScrape();
      break;
    case ApiEndpoint.OnMenuScrapeNow:
      body = await onMenuScrapeNow();
      break;
    case ApiEndpoint.OnMenuClearSeen:
      body = await onMenuClearSeen();
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  writeJSON<PartialJsonValue>("status" in body ? body.status : 200, body, rsp);
}

type ApiResponse = InitResponse | IncrementResponse | DecrementResponse;

type ErrorResponse = {
  error: string;
  status: number;
};

function getPostId(): string {
  if (!context.postId) {
    throw Error("no post ID");
  }
  return context.postId;
}

function getPostCountKey(postId: string): string {
  return `count:${postId}`;
}

async function onInit(): Promise<InitResponse> {
  const postId = getPostId();
  const count = Number((await redis.get(getPostCountKey(postId))) ?? 0);
  return {
    type: "init",
    postId,
    count,
    username: context.username ?? "user",
  };
}

async function onIncrement(req: IncomingMessage): Promise<IncrementResponse> {
  const postId = getPostId();
  const { amount } = await readJSON<IncrementRequest>(req).catch(() => ({
    amount: 1,
  }));
  const incrementBy = Number.isFinite(amount) ? amount : 1;
  const count = await redis.incrBy(getPostCountKey(postId), incrementBy);
  return {
    type: "increment",
    postId,
    count,
  };
}

async function onDecrement(req: IncomingMessage): Promise<DecrementResponse> {
  const postId = getPostId();
  const { amount } = await readJSON<DecrementRequest>(req).catch(() => ({
    amount: 1,
  }));
  const parsedAmount = typeof amount === "number" ? amount : Number(amount);
  const decrementBy = Number.isFinite(parsedAmount) ? parsedAmount : 1;
  const count = Number(
    await redis.incrBy(getPostCountKey(postId), -decrementBy),
  );
  return {
    type: "decrement",
    postId,
    count,
  };
}

async function onMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({ title: context.appName });
  return {
    showToast: { text: `Post ${post.id} created.`, appearance: "success" },
    navigateTo: post.url,
  };
}

async function onMenuScrapeNow(): Promise<UiResponse> {
  try {
    const summary = await runScrape();
    return {
      showToast: {
        text: `Scrape ${summary.date}: kept ${summary.kept}, skipped ${summary.skipped_seen} dup, ${summary.skipped_invalid} removed. Committed ${summary.committed_path}.`,
        appearance: "success",
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("scrape failed:", err);
    return {
      showToast: {
        text: `Scrape failed: ${msg.slice(0, 200)}`,
        appearance: "neutral",
      },
    };
  }
}

async function onMenuClearSeen(): Promise<UiResponse> {
  try {
    const removed = await clearSeenIds();
    return {
      showToast: {
        text: `Cleared seen_ids (${removed} entries removed)`,
        appearance: "success",
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("clearSeenIds failed:", err);
    return {
      showToast: {
        text: `Clear failed: ${msg.slice(0, 200)}`,
        appearance: "neutral",
      },
    };
  }
}

async function onAppInstall(): Promise<TriggerResponse> {
  // The recurring `daily-scrape` cron is declared declaratively in
  // devvit.json under `scheduler.tasks.daily-scrape` and auto-registers
  // when the app is installed. No runtime registration needed.
  return {};
}

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  return JSON.parse(`${Buffer.concat(chunks)}`);
}
