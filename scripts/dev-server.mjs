#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || "3007";
const restartDelayMs = Number(process.env.DEV_SERVER_RESTART_DELAY_MS || 1000);
const logDir = path.join(process.cwd(), ".stable-audio-radio");
const logPath = path.join(logDir, "dev-server.log");
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

mkdirSync(logDir, { recursive: true });
const logStream = createWriteStream(logPath, { flags: "a" });

let child = undefined;
let stopping = false;
const recentRestarts = [];

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
  process.stderr.write(line);
}

function rememberRestart() {
  const now = Date.now();
  recentRestarts.push(now);
  while (recentRestarts.length && now - recentRestarts[0] > 60_000) recentRestarts.shift();
  return recentRestarts.length;
}

function start() {
  log(`starting next dev on ${host}:${port}`);
  child = spawn(process.execPath, [nextBin, "dev", "-H", host, "-p", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });
  child.on("error", (error) => {
    log(`failed to start next dev: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    log(`next dev exited with code=${code ?? "null"} signal=${signal ?? "null"}`);
    child = undefined;

    if (stopping) {
      logStream.end();
      process.exit(code ?? (signal ? 128 : 0));
    }

    if (code === 0 || (code === null && signal === null)) {
      const restartCount = rememberRestart();
      if (restartCount > 5) {
        log("next dev exited too often in the last minute; stopping instead of restart-looping");
        logStream.end();
        process.exit(1);
      }
      log(`restarting next dev in ${restartDelayMs}ms`);
      setTimeout(start, restartDelayMs);
      return;
    }

    log("not restarting after non-zero or signaled exit");
    logStream.end();
    process.exit(code ?? 1);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal}; stopping next dev`);
  if (child?.pid) {
    child.kill(signal);
    return;
  }
  logStream.end();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

start();
