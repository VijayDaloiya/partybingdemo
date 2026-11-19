import { openDb } from '../lib/db.js';
import { createBooking, runReminders, id } from '../lib/crm.js';
try {process.loadEnvFile();} catch(e) {if(e.code!=='ENOENT') throw e;}
const db=openDb();
try {
  if(db.prepare('SELECT id FROM customers LIMIT 1').get()) throw new Error('Demo seed requires an empty customer database.');
  db.prepare("INSERT OR REPLACE INTO settings VALUES ('demonstration_data','true')").run();
  const products=[['Blush & Bloom','Soft pink balloons, florals and a little birthday magic.','Birthday Decoration',4999,'blush'],['Golden Hour','A luminous gold backdrop for your milestone moments.','Anniversary Decoration',6999,'gold'],['A Little Wonder','A dreamy pastel welcome for your newest chapter.','Baby Shower Decoration',5999,'lavender']];
  for(const p of products) db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,0)').run(id(),...p);
  const product=db.prepare("SELECT id FROM products WHERE service='Birthday Decoration' LIMIT 1").get();
  createBooking(db,{full_name:'Vijay (Demo)',phone:'+919876540001',email:'demo@example.com',city:'Bengaluru',product_id:product.id,occasion_type:'Birthday',celebrated_person:'Daughter',celebrant_name:'Ananya',relationship:'Daughter',occasion_date:'2026-09-03',event_date:'2026-09-03',recurring_annually:true,marketing_consent:true,reminder_permission:true,channels:['whatsapp','phone']});
  db.prepare("UPDATE bookings SET status='completed'").run();runReminders(db);console.log('Clearly labeled demonstration data created. No real messages will be sent.');
}finally{db.close();}
