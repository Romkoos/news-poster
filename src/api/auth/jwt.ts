import jwt from 'jsonwebtoken';
import { findUserById } from './db';

const SECRET = process.env.AUTH_JWT_SECRET || 'dev-secret-change-me';
const TTL = process.env.AUTH_TOKEN_TTL || '30d';

export type JwtPayload = { uid: number };

export function signToken(uid: number): string {
    return jwt.sign({ uid } satisfies JwtPayload, SECRET, { expiresIn: TTL });
}

export function verifyToken(token: string) {
    try {
        return jwt.verify(token, SECRET) as JwtPayload;
    } catch {
        return null;
    }
}

// Express-миддлвар для защищённых роутов (на будущее)
export function requireAuth(req: any, res: any, next: any) {
    const auth = req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
    const payload = verifyToken(auth.slice(7));
    if (!payload) return res.status(401).json({ message: 'Unauthorized' });
    const u = findUserById(payload.uid);
    if (!u) return res.status(401).json({ message: 'Unauthorized' });
    req.user = { id: u.id, email: u.email, name: u.name };
    next();
}

export function getUserFromAuthHeader(auth?: string) {
    if (!auth?.startsWith('Bearer ')) return null;
    const payload = verifyToken(auth.slice(7));
    if (!payload) return null;
    const u = findUserById(payload.uid);
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name };
}
