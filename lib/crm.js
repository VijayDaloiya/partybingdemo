import { pricedProduct, serviceEnabled } from './storefront.js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { transaction } from './db.js';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const getSettings = db => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key,x.value]));
export function todayInZone(timezone, date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date); }
export const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0,10);
export const daysBetween = (start, end) => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
export function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value; }
export function text(value, label, max=200, required=false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`Please provide a valid ${label}.`);
  return value.trim();
}
export function normalizePhone(value) {
  let digits = text(value,'phone number',30,true).replace(/[\s().-]/g,'');
  if (/^[6-9]\d{9}$/.test(digits)) digits = '+91' + digits;
  else if (/^91[6-9]\d{9}$/.test(digits)) digits = '+' + digits;
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) fail('Use a valid phone number including its country code.');
  return digits;
}
export function occurrence(occasion, year) {
  let month = occasion.occasion_month, day = occasion.occasion_day;
  if (month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) {
    if (occasion.leap_day_policy === 'skip') return null;
    if (occasion.leap_day_policy === 'mar1') { month=3; day=1; } else day=28;
  }
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function consentEvent(db, customerId, action, source) {
  db.prepare('INSERT INTO consent_events VALUES (?,?,?,?,?,?)').run(id(),customerId,action,source,'2026-10-v1',now());
}
export function audit(db, adminId, action, target, details='') { db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?,?)').run(id(),adminId,action,target,details,now()); }
export function canContact(db, customerId, channel) {
  return !!db.prepare(`SELECT c.id FROM customers c JOIN notification_preferences p ON p.customer_id=c.id WHERE c.id=? AND c.deleted_at IS NULL AND c.marketing_consent=1 AND c.marketing_opt_out_at IS NULL AND p.channel=? AND p.purpose='marketing' AND p.consent_status='granted'`).get(customerId,channel);
}
export function optOut(db, customerId, source='customer') {
  db.prepare('UPDATE customers SET marketing_consent=0, marketing_opt_out_at=?, updated_at=? WHERE id=?').run(now(),now(),customerId);
  db.prepare("UPDATE notification_preferences SET consent_status='denied',updated_at=? WHERE customer_id=?").run(now(),customerId);
  db.prepare('UPDATE customer_occasions SET reminder_enabled=0,next_reminder_date=NULL,updated_at=? WHERE customer_id=?').run(now(),customerId);
  db.prepare("UPDATE celebration_reminders SET status='disabled',updated_at=? WHERE status!='completed' AND customer_occasion_id IN (SELECT id FROM customer_occasions WHERE customer_id=?)").run(now(),customerId);
  consentEvent(db,customerId,'opted_out',source);
}

export function createBooking(db, data) {
  const fullName = text(data.full_name,'full name',100,true), phone = normalizePhone(data.phone);
  const email = text(data.email,'email',200); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Please provide a valid email.');
  const city = text(data.city,'city',100,true), address = text(data.address,'address',500);
  const type = text(data.occasion_type,'occasion type',80,true), who = text(data.celebrated_person,'person being celebrated',100);
  const celebrant = text(data.celebrant_name,'celebrant name',100), relationship = text(data.relationship,'relationship',80);
  if (!validDate(data.occasion_date) || !validDate(data.event_date) || [data.occasion_date,data.event_date].some(d=>Number(d.slice(0,4))<2000 || Number(d.slice(0,4))>2100)) fail('Choose valid occasion and event dates between 2000 and 2100.');
  const recurring = data.recurring_annually === true;
  const consent = data.marketing_consent === true && data.reminder_permission === true;
  const channels = Array.isArray(data.channels) ? [...new Set(data.channels)].filter(c => ['whatsapp','phone','email'].includes(c)) : [];
  if (consent && !channels.length) fail('Choose at least one follow-up channel, or leave reminder consent unchecked.');
  const product = db.prepare('SELECT * FROM products WHERE id=? AND archived=0').get(data.product_id || '');
  if (!product || !serviceEnabled(db,product.service)) fail('This decoration is no longer available. Please select another.');
  const quote = pricedProduct(db,product);
  if (data.expected_price !== undefined && Number(data.expected_price) !== quote.final_price) fail('The package price has changed. Close this form and refresh the page to review the latest price.',409);
  return transaction(db, () => {
    let customer = db.prepare('SELECT * FROM customers WHERE deleted_at IS NULL AND (normalized_phone=? OR id IN (SELECT customer_id FROM customer_phone_aliases WHERE normalized_phone=?))').get(phone,phone);
    const token = randomBytes(32).toString('hex');
    if (!customer) {
      const customerId=id();
      db.prepare(`INSERT INTO customers(id,full_name,normalized_phone,email,city,address,opt_out_token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(customerId,fullName,phone,email,city,address,hash(token),now(),now());
      customer=db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
    }
    // A public booking must never undo an existing opt-out or overwrite a known profile.
    const permitted = consent && !customer.marketing_opt_out_at;
    if (permitted) {
      db.prepare('UPDATE customers SET marketing_consent=1,marketing_consent_at=?,updated_at=? WHERE id=?').run(now(),now(),customer.id);
      for (const channel of channels) db.prepare(`INSERT INTO notification_preferences VALUES (?,?,?,'marketing','granted',?) ON CONFLICT(customer_id,channel,purpose) DO UPDATE SET consent_status='granted',updated_at=excluded.updated_at`).run(id(),customer.id,channel,now());
      consentEvent(db,customer.id,'granted:' + channels.join(','),'booking form');
    } else consentEvent(db,customer.id,consent ? 'blocked_by_existing_opt_out' : 'not_granted','booking form');
    const [year,month,day]=data.occasion_date.split('-').map(Number);
    let occasionId=null;
    if (recurring && permitted) {
      const existing=db.prepare(`SELECT id FROM customer_occasions WHERE customer_id=? AND occasion_type=? AND celebrant_name=? AND relationship=? AND celebrated_person=? AND occasion_month=? AND occasion_day=? AND recurring_annually=1`).get(customer.id,type,celebrant,relationship,who,month,day);
      occasionId=existing?.id || id();
      if (!existing) db.prepare(`INSERT INTO customer_occasions(id,customer_id,occasion_type,celebrated_person,celebrant_name,relationship,occasion_month,occasion_day,first_recorded_year,recurring_annually,reminder_enabled,leap_day_policy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?,?)`).run(occasionId,customer.id,type,who,celebrant,relationship,month,day,year,getSettings(db).leap_day_policy,now(),now());
    }
    const bookingId=id();
    db.prepare(`INSERT INTO bookings(id,customer_id,customer_occasion_id,product_id,product_name,product_theme,service_name,amount,occasion_type,celebrated_person,celebrant_name,relationship,recurring_occasion,occasion_date,event_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(bookingId,customer.id,occasionId,product.id,product.name,product.theme,product.service,quote.final_price,type,who,celebrant,relationship,recurring?1:0,data.occasion_date,data.event_date,now(),now());
    db.prepare('INSERT INTO booking_product_details VALUES (?,?,?,?,?)').run(bookingId,product.price,quote.effective_discount,quote.inclusions,quote.setup_type);
    if (occasionId) db.prepare('UPDATE customer_occasions SET last_booking_id=?,updated_at=? WHERE id=?').run(bookingId,now(),occasionId);
    // The bearer opt-out link can only revoke contact; it grants no access to customer details.
    db.prepare('UPDATE customers SET opt_out_token_hash=? WHERE id=?').run(hash(token),customer.id);
    db.prepare('INSERT INTO opt_out_links VALUES (?,?,?)').run(hash(token),customer.id,now());
    return { id:bookingId, opt_out_url:`/opt-out?token=${token}`, annual_reminder_saved:!!occasionId };
  });
}

export function runReminders(db, asOf = todayInZone(getSettings(db).timezone)) {
  if (!validDate(asOf)) fail('Invalid scheduler date.');
  return transaction(db, () => {
    let created=0;
    const year=Number(asOf.slice(0,4));
    const active=db.prepare(`SELECT o.* FROM customer_occasions o JOIN customers c ON c.id=o.customer_id WHERE o.recurring_annually=1 AND o.reminder_enabled=1 AND c.deleted_at IS NULL AND c.marketing_consent=1 AND c.marketing_opt_out_at IS NULL AND EXISTS(SELECT 1 FROM notification_preferences p WHERE p.customer_id=c.id AND p.purpose='marketing' AND p.consent_status='granted')`).all();
    for (const o of active) {
      if (o.paused_until && o.paused_until > asOf) continue;
      // Backfill all years since capture, including past due tasks after an outage.
      // Pre-create next year so the next annual reminder always exists.
      for (let y=o.first_recorded_year+1;y<=Math.max(year+1,o.first_recorded_year+1);y++) {
        const date=occurrence(o,y); if (!date) continue;
        const scheduled=addDays(date,-o.reminder_days_before);
        const prior=db.prepare('SELECT id FROM bookings WHERE customer_occasion_id=? AND occasion_date<? ORDER BY occasion_date DESC,created_at DESC LIMIT 1').get(o.id,date);
        created += Number(db.prepare(`INSERT OR IGNORE INTO celebration_reminders(id,customer_occasion_id,occasion_year,occurrence_date,scheduled_for,booking_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id(),o.id,y,date,scheduled,prior?.id || o.last_booking_id,now(),now()).changes);
        // A future task may predate a repeat booking. Keep its previous-design link current,
        // while preserving the design attached to already contacted/completed history.
        if (prior && date>asOf) db.prepare("UPDATE celebration_reminders SET booking_id=? WHERE customer_occasion_id=? AND occasion_year=? AND status IN ('pending','snoozed')").run(prior.id,o.id,y);
      }
      let next=null;
      for (let y=Math.max(year,o.first_recorded_year+1);y<=year+8 || y<=o.first_recorded_year+8;y++) {
        const date=occurrence(o,y); if (!date) continue;
        const scheduled=addDays(date,-o.reminder_days_before);
        if (scheduled>asOf) { next=scheduled; break; }
      }
      db.prepare('UPDATE customer_occasions SET next_reminder_date=?,updated_at=? WHERE id=?').run(next,now(),o.id);
    }
    db.prepare("INSERT INTO settings VALUES ('last_job_run',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now());
    return { created, as_of:asOf, active_occasions:active.length };
  });
}

const REMINDER_QUERY=`SELECT r.*,o.customer_id,o.occasion_type,o.celebrated_person,o.celebrant_name,o.relationship,o.reminder_enabled,o.paused_until,o.reminder_days_before,o.next_reminder_date,c.full_name,c.normalized_phone,c.marketing_consent,c.marketing_opt_out_at,b.product_name,b.product_theme,b.service_name,a.name AS assigned_admin FROM celebration_reminders r JOIN customer_occasions o ON o.id=r.customer_occasion_id JOIN customers c ON c.id=o.customer_id LEFT JOIN bookings b ON b.id=r.booking_id LEFT JOIN admins a ON a.id=r.assigned_admin_id WHERE c.deleted_at IS NULL`;
export function listReminders(db, filter='14', asOf=todayInZone(getSettings(db).timezone)) {
  return db.prepare(REMINDER_QUERY + ' ORDER BY r.occurrence_date,r.scheduled_for').all().map(r=>({...r, days_remaining:daysBetween(asOf,r.occurrence_date), effective_due:r.follow_up_at || r.scheduled_for, whatsapp_allowed:canContact(db,r.customer_id,'whatsapp'), phone_allowed:canContact(db,r.customer_id,'phone')})).filter(r=> {
    if (filter==='completed') return r.status==='completed';
    if (!r.reminder_enabled || !r.marketing_consent || r.marketing_opt_out_at || (r.paused_until && r.paused_until>asOf) || r.status==='disabled') return false;
    if (filter==='all') return true;
    if (r.status==='completed') return false;
    if (filter==='overdue') return r.effective_due<asOf;
    if (filter==='today') return r.effective_due===asOf;
    return r.effective_due<=addDays(asOf,Number(filter)||14) && r.effective_due>=asOf;
  });
}
export function metrics(db, asOf=todayInZone(getSettings(db).timezone)) {
  const all=listReminders(db,'all',asOf), open=all.filter(r=>r.status!=='completed');
  return {
    total_customers:db.prepare('SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL').get().n,
    returning_customers:db.prepare('SELECT COUNT(*) AS n FROM (SELECT c.id FROM customers c JOIN bookings b ON b.customer_id=c.id WHERE c.deleted_at IS NULL GROUP BY c.id HAVING COUNT(b.id)>1)').get().n,
    upcoming_celebrations:open.filter(r=>r.days_remaining>=0 && r.days_remaining<=30).length,
    due_today:open.filter(r=>r.effective_due===asOf).length,
    due_week:open.filter(r=>r.effective_due>=asOf && r.effective_due<=addDays(asOf,6)).length,
    completed:db.prepare("SELECT COUNT(*) AS n FROM celebration_reminders WHERE status='completed'").get().n,
    overdue:open.filter(r=>r.effective_due<asOf).length,
    today:asOf, ...getSettings(db)
  };
}
export function customers(db, search='') {
  const q=`%${text(search,'search',100)}%`;
  return db.prepare(`SELECT c.*,MIN(b.created_at) AS first_booking_date,MAX(b.created_at) AS last_booking_date,COUNT(b.id) AS total_bookings,COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.amount ELSE 0 END),0) AS confirmed_value FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id WHERE c.deleted_at IS NULL AND (c.full_name LIKE ? OR c.normalized_phone LIKE ? OR EXISTS(SELECT 1 FROM customer_occasions o WHERE o.customer_id=c.id AND (o.occasion_type LIKE ? OR o.celebrant_name LIKE ?)) OR EXISTS(SELECT 1 FROM bookings x WHERE x.customer_id=c.id AND x.occasion_type LIKE ?)) GROUP BY c.id ORDER BY c.updated_at DESC`).all(q,q,q,q,q).map(({opt_out_token_hash,...c})=>c);
}
export function customerProfile(db, customerId) {
  const c=customers(db).find(c=>c.id===customerId); if (!c) fail('Customer not found.',404);
  const bookings=db.prepare('SELECT * FROM bookings WHERE customer_id=? ORDER BY event_date DESC').all(customerId);
  const occasions=db.prepare('SELECT * FROM customer_occasions WHERE customer_id=?').all(customerId);
  const reminders=db.prepare(REMINDER_QUERY+' AND c.id=?').all(customerId);
  const interactions=db.prepare('SELECT i.*,a.name AS admin_name FROM customer_interactions i LEFT JOIN admins a ON a.id=i.admin_id WHERE customer_id=?').all(customerId);
  const consents=db.prepare('SELECT * FROM consent_events WHERE customer_id=? ORDER BY created_at DESC').all(customerId);
  const timeline=[
    ...bookings.map(b=>({id:b.id,date:b.created_at,type:'booking',title:`${b.service_name} — ${b.status}`,detail:`${b.product_name} · Event ${b.event_date} · ₹${b.amount.toLocaleString('en-IN')}`,booking:b})),
    ...reminders.map(r=>({id:r.id,date:r.created_at,type:'reminder',title:'Annual celebration reminder generated',detail:`${r.occasion_type} · ${r.occurrence_date} · Follow-up due ${r.scheduled_for}`})),
    ...interactions.map(i=>({id:i.id,date:i.contacted_at || i.created_at,type:'interaction',title:i.interaction_type.replaceAll('_',' '),detail:[i.interaction_outcome,i.notes,i.admin_name].filter(Boolean).join(' · ')})),
    ...consents.map(s=>({id:s.id,date:s.created_at,type:'consent',title:'Contact permission updated',detail:`${s.action} · ${s.source}`}))
  ].sort((a,b)=>b.date.localeCompare(a.date));
  return {...c,bookings,occasions,reminders,interactions,consents,timeline,notification_preferences:db.prepare('SELECT * FROM notification_preferences WHERE customer_id=?').all(customerId)};
}
export function reminderAction(db, reminderId, data, adminId) {
  return transaction(db,()=>{
    const r=db.prepare(REMINDER_QUERY+' AND r.id=?').get(reminderId); if (!r) fail('Reminder not found.',404);
    const action=data.action;
    if (r.status==='completed' && ['contacted','snooze','follow_up'].includes(action)) fail('This follow-up is already completed. Add a note to preserve its history.');
    if (action==='contacted') {
      if (!r.reminder_enabled || r.status==='disabled' || (r.paused_until && r.paused_until>todayInZone(getSettings(db).timezone)) || !['whatsapp','phone','email'].includes(data.channel) || !canContact(db,r.customer_id,data.channel)) fail('Contact is not permitted for this reminder or channel.',403);
      if (data.confirmed!==true) fail('Confirm actual contact before logging it.');
      db.prepare("UPDATE celebration_reminders SET status='contacted',updated_at=? WHERE id=?").run(now(),r.id);
    } else if (action==='completed') db.prepare("UPDATE celebration_reminders SET status='completed',completed_at=?,updated_at=? WHERE id=?").run(now(),now(),r.id);
    else if (action==='snooze' || action==='follow_up') {
      if (!validDate(data.date) || data.date<=todayInZone(getSettings(db).timezone)) fail('Choose a future follow-up date.');
      db.prepare("UPDATE celebration_reminders SET status='snoozed',follow_up_at=?,updated_at=? WHERE id=?").run(data.date,now(),r.id);
    } else if (action==='assign') {
      if (data.admin_id && !db.prepare('SELECT id FROM admins WHERE id=?').get(data.admin_id)) fail('Team member not found.');
      db.prepare('UPDATE celebration_reminders SET assigned_admin_id=?,updated_at=? WHERE id=?').run(data.admin_id || null,now(),r.id);
    } else if (action==='disable') {
      db.prepare('UPDATE customer_occasions SET reminder_enabled=0,next_reminder_date=NULL,updated_at=? WHERE id=?').run(now(),r.customer_occasion_id);
      db.prepare("UPDATE celebration_reminders SET status='disabled',updated_at=? WHERE customer_occasion_id=? AND status!='completed'").run(now(),r.customer_occasion_id);
    } else if (action!=='note') fail('Unknown reminder action.');
    const notes=text(data.notes,'notes',2000,action==='note'), outcome=text(data.outcome,'outcome',200);
    db.prepare('INSERT INTO customer_interactions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),r.customer_id,r.id,adminId,action==='contacted'?`${data.channel}_contacted`:action,outcome,notes,action==='contacted'?now():null,['snooze','follow_up'].includes(action)?data.date:null,now());
    if (action==='contacted' && outcome==='Asked to opt out') optOut(db,r.customer_id,'confirmed contact outcome');
    audit(db,adminId,`reminder.${action}`,r.id);
    return {ok:true};
  });
}
export function whatsappMessage(db, reminderId) {
  const r=db.prepare(REMINDER_QUERY+' AND r.id=?').get(reminderId); if (!r) fail('Reminder not found.',404);
  if (!canContact(db,r.customer_id,'whatsapp') || !r.reminder_enabled || r.status==='disabled' || (r.paused_until && r.paused_until>todayInZone(getSettings(db).timezone))) fail('WhatsApp follow-up is not permitted.',403);
  const subject=r.celebrant_name || r.relationship || r.celebrated_person || 'your family';
  const date=new Intl.DateTimeFormat('en-IN',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(`${r.occurrence_date}T12:00:00Z`));
  return {phone:r.normalized_phone.replace('+',''),message:`Hi ${r.full_name}! 🎉\n\nThis is Party Bing. We hope you and your family are doing well!\n\n${subject}'s ${r.occasion_type.toLowerCase()} on ${date} is coming up. We loved helping with ${r.product_name || 'your previous celebration'} and would love to help you plan another beautiful celebration.\n\nWould you like to explore some new decoration themes? Reply STOP to opt out of future follow-ups.\n\n— Team Party Bing`};
}
export function mergeCustomers(db, sourceId, targetId, adminId) {
  if (sourceId===targetId) fail('Choose two different customer records.');
  return transaction(db,()=>{
    const source=customerProfile(db,sourceId), target=customerProfile(db,targetId);
    // Default to the stricter consent state. No consent is inferred from a merge.
    const granted=source.marketing_consent && target.marketing_consent && !source.marketing_opt_out_at && !target.marketing_opt_out_at;
    for (const table of ['order_enquiries','bookings','customer_occasions','customer_interactions','consent_events','customer_phone_aliases','opt_out_links']) db.prepare(`UPDATE ${table} SET customer_id=? WHERE customer_id=?`).run(targetId,sourceId);
    if (source.normalized_phone) db.prepare('INSERT OR REPLACE INTO customer_phone_aliases VALUES (?,?)').run(source.normalized_phone,targetId);
    for (const channel of ['whatsapp','phone','email']) {
      const both=granted && source.notification_preferences.some(p=>p.channel===channel && p.consent_status==='granted') && target.notification_preferences.some(p=>p.channel===channel && p.consent_status==='granted');
      db.prepare(`INSERT INTO notification_preferences VALUES (?,?,?,'marketing',?,?) ON CONFLICT(customer_id,channel,purpose) DO UPDATE SET consent_status=excluded.consent_status,updated_at=excluded.updated_at`).run(id(),targetId,channel,both?'granted':'denied',now());
    }
    db.prepare('UPDATE customers SET internal_notes=?,preferences=?,updated_at=? WHERE id=?').run([target.internal_notes,source.internal_notes].filter(Boolean).join('\n'),[target.preferences,source.preferences].filter(Boolean).join('\n'),now(),targetId);
    if (!granted) optOut(db,targetId,'duplicate merge');
    db.prepare("UPDATE customers SET full_name='Merged customer',normalized_phone=NULL,email='',address='',city='',preferences='',internal_notes='',opt_out_token_hash=NULL,deleted_at=?,updated_at=? WHERE id=?").run(now(),now(),sourceId);
    db.prepare('DELETE FROM notification_preferences WHERE customer_id=?').run(sourceId);
    audit(db,adminId,'customer.merge',targetId,`Merged record ${sourceId}`);
    return {ok:true};
  });
}
export function eraseCustomer(db, customerId, adminId) {
  return transaction(db,()=>{
    customerProfile(db,customerId);
    db.prepare("UPDATE order_enquiries SET phone='',occasion='Erased',custom_addon='',message='',payload='',addons='[]' WHERE customer_id=?").run(customerId);
    optOut(db,customerId,'admin erasure');
    db.prepare("UPDATE customers SET full_name='Deleted customer',normalized_phone=NULL,email='',city='',address='',preferences='',internal_notes='',opt_out_token_hash=NULL,deleted_at=?,updated_at=? WHERE id=?").run(now(),now(),customerId);
    db.prepare("UPDATE bookings SET celebrated_person='',celebrant_name='',relationship='',occasion_type='Erased',occasion_date=substr(occasion_date,1,4)||'-01-01' WHERE customer_id=?").run(customerId);
    db.prepare("UPDATE customer_occasions SET celebrated_person='',celebrant_name='',relationship='',occasion_type='Erased',occasion_month=1,occasion_day=1 WHERE customer_id=?").run(customerId);
    db.prepare("UPDATE customer_interactions SET notes='',interaction_outcome='' WHERE customer_id=?").run(customerId);
    db.prepare('DELETE FROM notification_preferences WHERE customer_id=?').run(customerId);
    db.prepare('DELETE FROM customer_phone_aliases WHERE customer_id=?').run(customerId);
    db.prepare('DELETE FROM opt_out_links WHERE customer_id=?').run(customerId);
    audit(db,adminId,'customer.erased',customerId,'Direct identifiers erased; financial booking snapshots retained.');
    return {ok:true};
  });
}
