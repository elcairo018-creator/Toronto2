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
  );

  CREATE TABLE IF NOT EXISTS owned_cars (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    carId  INTEGER NOT NULL,
    FOREIGN KEY (carId) REFERENCES cars(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS houses (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    price INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS owned_houses (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    userId  TEXT NOT NULL,
    houseId INTEGER NOT NULL,
    FOREIGN KEY (houseId) REFERENCES houses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shops (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    ownerId TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shopId      INTEGER NOT NULL,
    name        TEXT NOT NULL,
    price       INTEGER NOT NULL,
    description TEXT,
    imageUrl    TEXT,
    createdBy   TEXT,
    FOREIGN KEY (shopId) REFERENCES shops(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shop_requests (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL,
    shopName  TEXT NOT NULL,
    guildId   TEXT NOT NULL,
    channelId TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS owned_items (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    itemId INTEGER NOT NULL,
    FOREIGN KEY (itemId) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS applications (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL,
    jobId     INTEGER NOT NULL,
    guildId   TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    fromId    TEXT NOT NULL,
    toId      TEXT NOT NULL,
    amount    INTEGER NOT NULL,
    note      TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migrazione: conto con saldo 0 → €500 ─────────────────────────────────────
try {
  db.prepare("UPDATE accounts SET balance = 500 WHERE balance = 0").run();
  logger.info("Migrazione saldo completata: conti a 0 portati a €500");
} catch (err) {
  logger.error({ err }, "Errore migrazione saldo");
}

// ── Carica lavori dal seed se la tabella è vuota ──────────────────────────────
try {
  const jobCount = (
    db.prepare("SELECT COUNT(*) as n FROM jobs").get() as { n: number }
  ).n;

  if (jobCount === 0 && fs.existsSync(JOBS_SEED_PATH)) {
    const seed = JSON.parse(fs.readFileSync(JOBS_SEED_PATH, "utf-8")) as Array<{
      name: string;
      roleId: string;
      salary: number;
      maxSlots: number | null;
    }>;

    const insert = db.prepare(
      "INSERT OR IGNORE INTO jobs (name, roleId, salary, maxSlots) VALUES (?, ?, ?, ?)",
    );
    const insertMany = db.transaction((jobs: typeof seed) => {
      for (const j of jobs) insert.run(j.name, j.roleId, j.salary, j.maxSlots);
    });
    insertMany(seed);
    logger.info(`Caricati ${seed.length} lavori da jobs_seed.json`);
  }
} catch (err) {
  logger.error({ err }, "Errore caricamento seed lavori");
}

// ── Esporta snapshot dei lavori in jobs_seed.json ─────────────────────────────
export function saveJobsSeed(): void {
  try {
    const jobs = db
      .prepare("SELECT name, roleId, salary, maxSlots FROM jobs")
      .all();
    fs.writeFileSync(JOBS_SEED_PATH, JSON.stringify(jobs, null, 2), "utf-8");
    logger.info("jobs_seed.json aggiornato");
  } catch (err) {
    logger.error({ err }, "Errore salvataggio seed lavori");
  }
}

// ── Interfacce TypeScript ─────────────────────────────────────────────────────

export interface Account {
  userId: string;
  pin: string | null;
  balance: number;
}

export interface Job {
  id: number;
  name: string;
  roleId: string;
  salary: number;
  maxSlots: number | null;
  currentSlots: number;
}

export interface Employee {
  userId: string;
  jobId: number;
  lastSalary: string | null;
}

export interface Application {
  id: number;
  userId: string;
  jobId: number;
  guildId: string;
  status: string;
  createdAt: string;
}

export interface Card {
  id: number;
  userId: string;
  cardNumber: string;
  cvv: string;
  expiry: string;
}

export interface Car {
  id: number;
  name: string;
  price: number;
}

export interface House {
  id: number;
  name: string;
  price: number;
}

export interface Shop {
  id: number;
  name: string;
  ownerId: string | null;
}

export interface Product {
  id: number;
  shopId: number;
  name: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  createdBy: string | null;
}

export interface ShopRequest {
  id: number;
  userId: string;
  shopName: string;
  guildId: string;
  channelId: string;
  status: string;
  createdAt: string;
}

export default db;
