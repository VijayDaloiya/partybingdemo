import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDb } from '../lib/db.js';
import { createAdmin } from '../lib/auth.js';
try {process.loadEnvFile();} catch(e) {if(e.code!=='ENOENT') throw e;}
const db=openDb();
try {
  if(db.prepare('SELECT id FROM admins LIMIT 1').get()) {console.log('An admin already exists. Setup left the account unchanged.');}
  else {
    const password=process.env.ADMIN_PASSWORD || randomBytes(21).toString('base64url');
    const email=process.env.ADMIN_EMAIL || 'owner@partybing.local';
    createAdmin(db,{name:process.env.ADMIN_NAME || 'Party Bing Owner',email,password,role:'owner'});
    mkdirSync('./data',{recursive:true});
    writeFileSync('./data/local-access.txt',`Party Bing local workspace\n\nURL: http://127.0.0.1:3000/admin/login\nEmail: ${email}\nPassword: ${password}\n\nKeep this file private. It is ignored by Git. Move the password to your password manager and remove this file when no longer needed.\n`,{mode:0o600});
    console.log('Owner account created. Local sign-in details are in data/local-access.txt (ignored by Git).');
  }
}finally{db.close();}
