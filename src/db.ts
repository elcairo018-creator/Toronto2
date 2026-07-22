import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "bot.db");
const JOBS_SEED_PATH = path.join(__dirname, "..", "jobs_seed.json");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    userId    TEXT PRIMARY KEY,
    pin       TEXT,
    balance   INTEGER DEFAULT 500
  );

  CREATE TABLE IF NOT EXISTS cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    cardNumber TEXT NOT NULL UNIQUE,
    cvv        TEXT NOT NULL,
    expiry     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    roleId       TEXT NOT NULL,
    salary       INTEGER DEFAULT 0,
    maxSlots     INTEGER,
    currentSlots INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS employees (
    userId     TEXT NOT NULL,
    jobId      INTEGER NOT NULL,
    lastSalary TEXT,
    PRIMARY KEY (userId, jobId),
    FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cars (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    price INTEGER NOT NULL
