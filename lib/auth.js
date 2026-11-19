import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { id, now, fail, hash } from './crm.js';
export function passwordHash(password) { const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(password,salt,64).toString('hex'); }
export function verifyPassword(password, stored) { const [salt,hex]=stored.split(':'); return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(hex,'hex')); }
export function createAdmin(db,{name,email,password,role='admin'}) {
  if (!name || !email?.includes('@') || typeof password!=='string' || password.length<12) fail('Provide a name, email and a password of at least 12 characters.');
  db.prepare('INSERT INTO admins VALUES (?,?,?,?,?,?)').run(id(),name,email.toLowerCase(),passwordHash(password),role,now());
}
export function login(db,email,password) {
  const admin=db.prepare('SELECT * FROM admins WHERE email=?').get(String(email).toLowerCase());
  const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);
  if (!verifyPassword(String(password),admin?.password_hash || dummy) || !admin) fail('Incorrect email or password.',401);
  const token=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),admin.id,csrf,new Date(Date.now()+8*3600000).toISOString());
  return {token,csrf,admin:{id:admin.id,name:admin.name,role:admin.role}};
}
export function session(db,req) {
  const token=(req.headers.cookie || '').split(';').map(c=>c.trim()).find(c=>c.startsWith('pb_session='))?.slice(11);
  return token ? db.prepare('SELECT a.id,a.name,a.email,a.role,s.csrf FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token),now()) : null;
}
