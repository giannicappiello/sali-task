import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createSmtpClient } from "../../server/email/smtp-client.js";
import {
  ORDER_EMAIL_LEASE_SECONDS,
  processNextOrderEmailJob,
} from "../../server/orders/order-email-job.js";

export const ORDER_EMAIL_IDLE_WAIT_MS = 60_000;

function requiredEnv(environment, name) {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`Variabile ambiente mancante: ${name}`);
  return value;
}

function printResult(logger, result) {
  logger.log(JSON.stringify({
    event: "order_email_worker_result",
    ...result,
  }));
}

function parseMode(args) {
  if (args.length === 0) return { once: false };
  if (args.length === 1 && args[0] === "--once") return { once: true };
  throw new Error(`Argomenti non supportati: ${args.join(" ")}`);
}

export function createOrderEmailWorkerId() {
  return `order-email-windows:${hostname()}:${process.pid}:${randomUUID()}`;
}

export async function runOrderEmailWorker({
  args = process.argv.slice(2),
  environment = process.env,
  logger = console,
  signalSource = process,
  createSupabaseClient = createClient,
  createSmtp = createSmtpClient,
  processJob = processNextOrderEmailJob,
  workerId = createOrderEmailWorkerId(),
  leaseSeconds = ORDER_EMAIL_LEASE_SECONDS,
  idleWaitMs = ORDER_EMAIL_IDLE_WAIT_MS,
  wait = (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
} = {}) {
  const { once } = parseMode(args);
  const supabase = createSupabaseClient(
    requiredEnv(environment, "SUPABASE_URL"),
    requiredEnv(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const smtp = createSmtp();
  const shutdown = new AbortController();
  let stopping = false;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    shutdown.abort();
    logger.log(JSON.stringify({
      event: "order_email_worker_stopping",
      workerId,
      signal,
    }));
  };
  const onSigint = () => stop("SIGINT");
  const onSigterm = () => stop("SIGTERM");

  signalSource.once("SIGINT", onSigint);
  signalSource.once("SIGTERM", onSigterm);

  try {
    do {
      const result = await processJob({
        supabase,
        smtp,
        workerId,
        leaseSeconds,
        logger,
      });
      printResult(logger, result);
      if (once || stopping) return result;

      if (result.status === "idle" || result.status === "error") {
        try {
          await wait(idleWaitMs, shutdown.signal);
        } catch (error) {
          if (error?.name !== "AbortError") throw error;
        }
      }
    } while (!stopping);

    return { status: "stopped", workerId };
  } finally {
    signalSource.off("SIGINT", onSigint);
    signalSource.off("SIGTERM", onSigterm);
  }
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    await runOrderEmailWorker();
  } catch (error) {
    console.error(JSON.stringify({
      event: "order_email_worker_startup_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  }
}
