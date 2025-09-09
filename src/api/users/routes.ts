import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import { createUser, findUserByEmail, ensureSeedAdmin } from '../auth/db';
import { getUserFromAuthHeader, signToken } from '../auth/jwt';

const router = Router();

ensureSeedAdmin();

// POST /api/users/login
router.post('/login', (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ message: 'Email и пароль обязательны' });

    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ message: 'Неверный логин или пароль' });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Неверный логин или пароль' });

    const token = signToken(user.id);
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// GET /api/users/me
router.get('/me', (req, res) => {
    const me = getUserFromAuthHeader(req.header('Authorization') || undefined);
    if (!me) return res.status(401).json({ message: 'Unauthorized' });
    return res.json({ user: me });
});

// POST /api/users/logout — stateless (no-op)
router.post('/logout', (_req, res) => res.status(204).end());

// (опционально) ручной signup
router.post('/signup', (req, res) => {
    const { email, password, name } = (req.body ?? {}) as { email?: string; password?: string; name?: string };
    if (!email || !password) return res.status(400).json({ message: 'Email и пароль обязательны' });
    if (findUserByEmail(email)) return res.status(409).json({ message: 'Email уже существует' });
    const u = createUser(email, password, name);
    return res.status(201).json({ user: { id: u.id, email: u.email, name: u.name } });
});

export default router;
