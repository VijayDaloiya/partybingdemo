import { openDb } from '../lib/db.js';
import { createBooking, runReminders, id, now, todayInZone, getSettings, addDays, metrics } from '../lib/crm.js';

try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const db = openDb();
try {
  if (getSettings(db).demonstration_data !== 'true') {
    throw new Error('This sample pack is only for a clearly labeled demonstration database.');
  }
  const today = todayInZone(getSettings(db).timezone);
  const owner = db.prepare("SELECT id FROM admins WHERE role='owner' LIMIT 1").get();
  const additions = [
    ['Midnight Sparkle', 'Navy, silver and shimmering lights for a milestone birthday.', 'Birthday Decoration', 7499, 'lavender'],
    ['Garden of Love', 'A floral anniversary backdrop with soft lights and elegant details.', 'Anniversary Decoration', 8999, 'blush'],
    ['Little Sunshine', 'A cheerful pastel yellow welcome for a baby shower.', 'Baby Shower Decoration', 6499, 'gold'],
    ['The Grand Toast', 'A polished gold and ivory setup for office milestones.', 'Corporate Decoration', 12999, 'gold'],
  ];
  for (const p of additions) {
    if (!db.prepare('SELECT id FROM products WHERE name=?').get(p[0])) {
      db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,0)').run(id(), ...p);
    }
  }
  const samples = [
    ['Priya Sharma', 'Bengaluru', 'Birthday', 'Aarav', 'Son', 14, 'Blush & Bloom', 'pending'],
    ['Rahul Mehta', 'Mumbai', 'Anniversary', '', 'Spouse', 17, 'Garden of Love', 'contacted'],
    ['Sneha Patel', 'Pune', 'Birthday', 'Riya', 'Daughter', 21, 'Midnight Sparkle', 'pending'],
    ['Arjun Rao', 'Hyderabad', 'Birthday', '', 'Self', 10, 'Midnight Sparkle', 'pending'],
    ['Neha Kapoor', 'Delhi', 'Anniversary', '', 'Spouse', 12, 'Golden Hour', 'completed'],
    ['Kavya Iyer', 'Chennai', 'Birthday', 'Meera', 'Daughter', 28, 'Blush & Bloom', 'snoozed'],
    ['Ananya Das', 'Kolkata', 'Baby shower', '', 'Self', 8, 'Little Sunshine', 'one-time'],
    ['Rohan Shah', 'Ahmedabad', 'Corporate event', '', 'Team', 24, 'The Grand Toast', 'one-time'],
  ];
  let added = 0;
  for (const [index, sample] of samples.entries()) {
    const [name, city, type, celebrant, relationship, offset, productName, state] = sample;
    // Reserved fictional North American phone numbers; never real customer contacts.
    const phone = `+120255501${String(index + 1).padStart(2, '0')}`;
    if (db.prepare('SELECT id FROM customers WHERE normalized_phone=?').get(phone)) continue;
    const product = db.prepare('SELECT id FROM products WHERE name=? AND archived=0').get(productName);
    if (!product) throw new Error(`Missing sample decoration: ${productName}`);
    const upcoming = addDays(today, offset);
    const previous = `${Number(upcoming.slice(0, 4)) - 1}${upcoming.slice(4)}`;
    const recurring = state !== 'one-time';
    const data = {
      full_name: `${name} (Demo)`, phone, email: `sample${index + 1}@example.com`, city,
      product_id: product.id, occasion_type: type, celebrated_person: relationship,
      celebrant_name: celebrant, relationship, occasion_date: recurring ? previous : upcoming,
      event_date: recurring ? previous : upcoming, recurring_annually: recurring,
      reminder_permission: recurring, marketing_consent: recurring, channels: ['whatsapp', 'phone'],
    };
    const booking = createBooking(db, data);
    const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(booking.id);
    const captured = `${recurring ? addDays(previous, -20) : today}T09:00:00.000Z`;
    db.prepare('UPDATE bookings SET status=?,created_at=?,updated_at=? WHERE id=?')
      .run(recurring ? 'completed' : 'requested', captured, captured, booking.id);
    db.prepare('UPDATE customers SET preferences=?,internal_notes=?,created_at=? WHERE id=?')
      .run(index % 2 ? 'Elegant florals and warm lighting.' : 'Pastel balloons and a personalized backdrop.',
        'DEMONSTRATION DATA: fictional customer, reserved sample phone number, and simulated booking history. Do not contact.', captured, row.customer_id);
    // Give two customers a second, upcoming booking to exercise returning-customer totals.
    if (index === 0 || index === 1) {
      const repeat = createBooking(db, { ...data, occasion_date: upcoming, event_date: upcoming });
      db.prepare("UPDATE bookings SET status='confirmed' WHERE id=?").run(repeat.id);
    }
    if (recurring) {
      runReminders(db, today);
      const reminder = db.prepare('SELECT id FROM celebration_reminders WHERE customer_occasion_id=? AND occasion_year=?')
        .get(row.customer_occasion_id, Number(upcoming.slice(0, 4)));
      db.prepare('UPDATE celebration_reminders SET status=?,assigned_admin_id=?,completed_at=?,follow_up_at=? WHERE id=?')
        .run(state, index % 2 ? owner?.id || null : null, state === 'completed' ? now() : null,
          state === 'snoozed' ? addDays(today, 5) : null, reminder.id);
      if (['completed', 'contacted', 'snoozed'].includes(state)) {
        db.prepare('INSERT INTO customer_interactions VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id(), row.customer_id, reminder.id, owner?.id || null, 'demo_follow_up',
            state === 'contacted' ? 'Sample: requested new package' : `Sample: ${state}`,
            'SIMULATED demo activity only. No message or call was made.', null,
            state === 'snoozed' ? addDays(today, 5) : null, now());
      }
    }
    added++;
  }
  runReminders(db, today);
  console.log(JSON.stringify({ added_sample_customers: added, ...metrics(db, today) }, null, 2));
} finally { db.close(); }
