import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "bot.db");
const JOBS_SEED_PATH  = path.join(__dirname, "..", "jobs_seed.json");
const CARS_SEED_PATH  = path.join(__dirname, "..", "cars_seed.json");
const HOUSES_SEED_PATH = path.join(__dirname, "..", "houses_seed.json");
const SEED_REPO   = process.env.GITHUB_REPO   ?? "elcairo018-creator/Toronto2";
const SEED_BRANCH = process.env.GITHUB_BRANCH ?? "main";

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
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    price    INTEGER NOT NULL,
    imageUrl TEXT
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

  CREATE TABLE IF NOT EXISTS panels (
    name      TEXT PRIMARY KEY,
    channelId TEXT NOT NULL,
    messageId TEXT NOT NULL
  );
`);

// ── Migrazione: conto con saldo 0 → €500 ─────────────────────────────────────
try {
  db.prepare("UPDATE accounts SET balance = 500 WHERE balance = 0").run();
  logger.info("Migrazione saldo completata: conti a 0 portati a €500");
} catch (err) {
  logger.error({ err }, "Errore migrazione saldo");
}

// ── Migrazione: aggiungi candidatureChannelId a jobs se non esiste ────────────
try {
  db.prepare("ALTER TABLE jobs ADD COLUMN candidatureChannelId TEXT").run();
  logger.info("Migrazione jobs: aggiunta colonna candidatureChannelId");
} catch { /* colonna già presente — ignora */ }

// ── Migrazione: aggiungi imageUrl a houses se non esiste ──────────────────────
try {
  db.prepare("ALTER TABLE houses ADD COLUMN imageUrl TEXT").run();
  logger.info("Migrazione houses: aggiunta colonna imageUrl");
} catch { /* colonna già presente — ignora */ }

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
      "INSERT OR IGNORE INTO jobs (name, roleId, salary, maxSlots, candidatureChannelId) VALUES (?, ?, ?, ?, ?)",
    );
    const insertMany = db.transaction((jobs: typeof seed) => {
      for (const j of jobs) insert.run(j.name, j.roleId, j.salary, j.maxSlots, (j as any).candidatureChannelId ?? null);
    });
    insertMany(seed);
    logger.info(`Caricati ${seed.length} lavori da jobs_seed.json`);
  }
} catch (err) {
  logger.error({ err }, "Errore caricamento seed lavori");
}

// ── Carica auto dal seed se la tabella è vuota ────────────────────────────────
try {
  const carCount = (db.prepare("SELECT COUNT(*) as n FROM cars").get() as { n: number }).n;
  if (carCount === 0 && fs.existsSync(CARS_SEED_PATH)) {
    const seed = JSON.parse(fs.readFileSync(CARS_SEED_PATH, "utf-8")) as Array<{ name: string; price: number }>;
    const insert = db.prepare("INSERT OR IGNORE INTO cars (name, price) VALUES (?, ?)");
    db.transaction((rows: typeof seed) => { for (const r of rows) insert.run(r.name, r.price); })(seed);
    logger.info(`Caricate ${seed.length} auto da cars_seed.json`);
  }
} catch (err) {
  logger.error({ err }, "Errore caricamento seed auto");
}

// ── Carica case dal seed se la tabella è vuota ────────────────────────────────
try {
  const houseCount = (db.prepare("SELECT COUNT(*) as n FROM houses").get() as { n: number }).n;
  if (houseCount === 0 && fs.existsSync(HOUSES_SEED_PATH)) {
    const seed = JSON.parse(fs.readFileSync(HOUSES_SEED_PATH, "utf-8")) as Array<{ name: string; price: number; imageUrl: string | null }>;
    const insert = db.prepare("INSERT OR IGNORE INTO houses (name, price, imageUrl) VALUES (?, ?, ?)");
    db.transaction((rows: typeof seed) => { for (const r of rows) insert.run(r.name, r.price, r.imageUrl ?? null); })(seed);
    logger.info(`Caricate ${seed.length} case da houses_seed.json`);
  }
} catch (err) {
  logger.error({ err }, "Errore caricamento seed case");
}

// ── Salvataggio seed su GitHub ────────────────────────────────────────────────
// Ogni tipo di seed ha la propria coda per evitare conflitti di SHA concorrenti.
let jobsSeedQueue:   Promise<void> = Promise.resolve();
let carsSeedQueue:   Promise<void> = Promise.resolve();
let housesSeedQueue: Promise<void> = Promise.resolve();

/** Salva i lavori localmente e su GitHub. Attendi il risultato per conferma. */
export function saveJobsSeed(): Promise<void> {
  const rows = db
    .prepare("SELECT name, roleId, salary, maxSlots, candidatureChannelId FROM jobs")
    .all();
  const content = JSON.stringify(rows, null, 2);
  fs.writeFileSync(JOBS_SEED_PATH, content, "utf-8");
  logger.info("jobs_seed.json aggiornato (locale)");
  const push = jobsSeedQueue.then(() => pushSeedToGitHub("jobs_seed.json", content, "chore: aggiorna jobs_seed.json [skip ci]"));
  jobsSeedQueue = push.catch(() => undefined);
  return push;
}

/** Salva le auto localmente e su GitHub. Attendi il risultato per conferma. */
export function saveCarsSeed(): Promise<void> {
  const rows = db.prepare("SELECT name, price FROM cars").all();
  const content = JSON.stringify(rows, null, 2);
  fs.writeFileSync(CARS_SEED_PATH, content, "utf-8");
  logger.info("cars_seed.json aggiornato (locale)");
  const push = carsSeedQueue.then(() => pushSeedToGitHub("cars_seed.json", content, "chore: aggiorna cars_seed.json [skip ci]"));
  carsSeedQueue = push.catch(() => undefined);
  return push;
}

/** Salva le case localmente e su GitHub. Attendi il risultato per conferma. */
export function saveHousesSeed(): Promise<void> {
  const rows = db.prepare("SELECT name, price, imageUrl FROM houses").all();
  const content = JSON.stringify(rows, null, 2);
  fs.writeFileSync(HOUSES_SEED_PATH, content, "utf-8");
  logger.info("houses_seed.json aggiornato (locale)");
  const push = housesSeedQueue.then(() => pushSeedToGitHub("houses_seed.json", content, "chore: aggiorna houses_seed.json [skip ci]"));
  housesSeedQueue = push.catch(() => undefined);
  return push;
}

async function pushSeedToGitHub(filename: string, content: string, message: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(`GITHUB_TOKEN non configurato: impossibile salvare ${filename} su GitHub`);
  }

  const apiBase = `https://api.github.com/repos/${SEED_REPO}/contents/${filename}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "toronto-economy-bot",
    Accept: "application/vnd.github+json",
  };

  // Recupera SHA del file attuale (necessario per aggiornarlo)
  const getRes = await fetch(`${apiBase}?ref=${SEED_BRANCH}`, { headers });
  let sha: string | undefined;
  if (getRes.ok) {
    const data = (await getRes.json()) as { sha?: string };
    sha = data.sha;
  } else if (getRes.status !== 404) {
    const text = await getRes.text();
    throw new Error(`GitHub API ${getRes.status}: ${text}`);
  }

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: SEED_BRANCH,
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiBase, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`GitHub API ${putRes.status}: ${text}`);
  }
  logger.info(`${filename} sincronizzato su GitHub`);
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
  candidatureChannelId: string | null;
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
  imageUrl: string | null;
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
