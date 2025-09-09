import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as bcrypt from 'bcryptjs';

const db = new Database(path.resolve('data', 'news.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
                                         id            INTEGER PRIMARY KEY AUTOINCREMENT,
                                         email         TEXT NOT NULL UNIQUE,
                                         password_hash TEXT NOT NULL,
                                         name          TEXT,
                                         created_at    INTEGER NOT NULL
    );
`);

export type DbUser = { id:number; email:string; name?:string; password_hash:string; created_at:number };

export function findUserByEmail(email: string): DbUser | undefined {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as DbUser | undefined;
}
export function findUserById(id: number): DbUser | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
}
export function createUser(email: string, password: string, name?: string): DbUser {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(
        'INSERT INTO users(email, password_hash, name, created_at) VALUES(?, ?, ?, ?)'
    );
    const info = stmt.run(email, hash, name ?? null, Date.now());
    return findUserById(Number(info.lastInsertRowid))!;
}

export function ensureSeedAdmin() {
    const email = process.env.AUTH_SEED_EMAIL;
    const pass  = process.env.AUTH_SEED_PASSWORD;
    const name  = process.env.AUTH_SEED_NAME || 'Admin';
    if (!email || !pass) return;
    if (!findUserByEmail(email)) createUser(email, pass, name);
}

export { db };
