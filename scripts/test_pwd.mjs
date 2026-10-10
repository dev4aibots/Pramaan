import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';

const db = new PGlite('./.pgdata');
const res = await db.query("select email, password_hash from users where email = 'student@atmiya.edu'");
console.log('User row:', res.rows[0]);
const check = await bcrypt.compare('password1234', res.rows[0].password_hash);
console.log('Direct bcrypt.compare matches password1234?', check);
await db.close();
