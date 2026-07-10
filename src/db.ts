import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "bot.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    userId    TEXT PRIMARY KEY,
    pin       TEXT,
    balance   INTEGER DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS houses (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    price INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shops (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    ownerId TEXT
  );

  CREATE TABLE IF NOT EXISTS shop_requests (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL,
    shopName  TEXT NOT NULL,
    guildId   TEXT NOT NULL,
    channelId TEXT,
    status    TEXT DEFAULT 'pending',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shopId      INTEGER NOT NULL,
    name        TEXT NOT NULL,
    price       INTEGER NOT NULL,
    description TEXT DEFAULT '',
    imageUrl    TEXT,
    FOREIGN KEY (shopId) REFERENCES shops(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS applications (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL,
    jobId     INTEGER NOT NULL,
    guildId   TEXT NOT NULL,
    status    TEXT DEFAULT 'pending',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrazione: aggiunge la colonna ownerId a shops se il DB esisteva già senza.
const shopCols = db.prepare("PRAGMA table_info(shops)").all() as { name: string }[];
if (!shopCols.some((c) => c.name === "ownerId")) {
  db.exec("ALTER TABLE shops ADD COLUMN ownerId TEXT");
}

logger.info({ path: DB_PATH }, "SQLite database initialized");

export type Account = { userId: string; pin: string | null; balance: number };
export type Card = { id: number; userId: string; cardNumber: string; cvv: string; expiry: string };
export type Job = { id: number; name: string; roleId: string; salary: number; maxSlots: number | null; currentSlots: number };
export type Employee = { userId: string; jobId: number; lastSalary: string | null };
export type Car = { id: number; name: string; price: number };
export type House = { id: number; name: string; price: number };
export type Shop = { id: number; name: string; ownerId: string | null };
export type Product = { id: number; shopId: number; name: string; price: number; description: string; imageUrl: string | null };
export type Application = { id: number; userId: string; jobId: number; guildId: string; status: string; createdAt: string };
export type ShopRequest = { id: number; userId: string; shopName: string; guildId: string; channelId: string | null; status: string; createdAt: string };

export default db;
