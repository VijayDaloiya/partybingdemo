import { openDb } from '../lib/db.js';
import { runReminders } from '../lib/crm.js';
try {process.loadEnvFile();} catch(e) {if(e.code!=='ENOENT') throw e;}
const db=openDb();try {console.log(JSON.stringify(runReminders(db,process.argv[2])));} finally {db.close();}
