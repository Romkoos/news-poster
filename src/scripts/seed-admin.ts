import 'dotenv/config';
import { createUser, findUserByEmail } from '../api/auth/db';

(async () => {
    const email = process.env.AUTH_SEED_EMAIL;
    const pass  = process.env.AUTH_SEED_PASSWORD;
    const name  = process.env.AUTH_SEED_NAME || 'Admin';

    if (!email || !pass) {
        console.error('AUTH_SEED_EMAIL / AUTH_SEED_PASSWORD not set');
        process.exit(1);
    }

    if (findUserByEmail(email)) {
        console.log('User already exists:', email);
    } else {
        const u = createUser(email, pass, name);
        console.log('User created:', u.email, 'id=', u.id);
    }
})();
