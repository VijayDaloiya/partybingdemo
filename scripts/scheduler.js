import { openDb } from '../lib/db.js';
import { runReminders } from '../lib/crm.js';
try {process.loadEnvFile();} catch(e) {if(e.code!=='ENOENT') throw e;}
const db=openDb();
function tick(){try{console.log(JSON.stringify(runReminders(db)));}catch(e){console.error('Reminder job failed:',e.message);}}
tick();const timer=setInterval(tick,3600000);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{clearInterval(timer);db.close();process.exit(0);});
