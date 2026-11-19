import { openDb } from '../lib/db.js';
import { createAdmin } from '../lib/auth.js';
try {process.loadEnvFile();} catch(e) {if(e.code!=='ENOENT') throw e;}
const db=openDb();
try {createAdmin(db,{name:process.env.ADMIN_NAME||'Party Bing Admin',email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD,role:process.env.ADMIN_ROLE||'owner'});console.log('Admin created. Sign in at /admin/login.');} finally {db.close();}
