import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path = process.env.DATABASE_PATH || './data/party-bing.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','owner')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, full_name TEXT NOT NULL, normalized_phone TEXT UNIQUE, email TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '', internal_notes TEXT NOT NULL DEFAULT '', marketing_consent INTEGER NOT NULL DEFAULT 0, marketing_consent_at TEXT, marketing_opt_out_at TEXT,
      opt_out_token_hash TEXT UNIQUE, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, service TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), theme TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS customer_phone_aliases (normalized_phone TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id));
    CREATE TABLE IF NOT EXISTS featured_products (product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS opt_out_links (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_occasions (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), occasion_type TEXT NOT NULL, celebrated_person TEXT NOT NULL DEFAULT '', celebrant_name TEXT NOT NULL DEFAULT '', relationship TEXT NOT NULL DEFAULT '',
      occasion_month INTEGER NOT NULL CHECK(occasion_month BETWEEN 1 AND 12), occasion_day INTEGER NOT NULL CHECK(occasion_day BETWEEN 1 AND 31), first_recorded_year INTEGER NOT NULL,
      recurring_annually INTEGER NOT NULL DEFAULT 0, reminder_enabled INTEGER NOT NULL DEFAULT 0, reminder_days_before INTEGER NOT NULL DEFAULT 14 CHECK(reminder_days_before BETWEEN 0 AND 365),
      leap_day_policy TEXT NOT NULL CHECK(leap_day_policy IN ('feb28','mar1','skip')), last_booking_id TEXT REFERENCES bookings(id), next_reminder_date TEXT, paused_until TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), customer_occasion_id TEXT REFERENCES customer_occasions(id), product_id TEXT REFERENCES products(id),
      product_name TEXT NOT NULL, product_theme TEXT NOT NULL, service_name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','confirmed','completed','cancelled')),
      occasion_type TEXT NOT NULL, celebrated_person TEXT NOT NULL DEFAULT '', celebrant_name TEXT NOT NULL DEFAULT '', relationship TEXT NOT NULL DEFAULT '', recurring_occasion INTEGER NOT NULL DEFAULT 0,
      occasion_date TEXT NOT NULL, event_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS celebration_reminders (
      id TEXT PRIMARY KEY, customer_occasion_id TEXT NOT NULL REFERENCES customer_occasions(id), occasion_year INTEGER NOT NULL, occurrence_date TEXT NOT NULL, scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacted','completed','snoozed','disabled')), assigned_admin_id TEXT REFERENCES admins(id), booking_id TEXT REFERENCES bookings(id), follow_up_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(customer_occasion_id, occasion_year)
    );
    CREATE TABLE IF NOT EXISTS customer_interactions (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), reminder_id TEXT REFERENCES celebration_reminders(id), admin_id TEXT REFERENCES admins(id),
      interaction_type TEXT NOT NULL, interaction_outcome TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', contacted_at TEXT, next_follow_up_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), channel TEXT NOT NULL CHECK(channel IN ('whatsapp','phone','email')), purpose TEXT NOT NULL DEFAULT 'marketing',
      consent_status TEXT NOT NULL CHECK(consent_status IN ('granted','denied')), updated_at TEXT NOT NULL, UNIQUE(customer_id, channel, purpose)
    );
    CREATE TABLE IF NOT EXISTS consent_events (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), action TEXT NOT NULL, source TEXT NOT NULL, policy_version TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, admin_id TEXT REFERENCES admins(id), action TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_booking_customer ON bookings(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_occasion_customer ON customer_occasions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_occasion_active ON customer_occasions(reminder_enabled, recurring_annually);
    CREATE INDEX IF NOT EXISTS idx_reminder_due ON celebration_reminders(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_interaction_customer ON customer_interactions(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_customer_name ON customers(full_name COLLATE NOCASE);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS product_details (
    product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    inclusions TEXT NOT NULL, setup_type TEXT NOT NULL CHECK(setup_type IN ('wall','stand','both','unspecified')),
    discount_percent INTEGER CHECK(discount_percent BETWEEN 0 AND 100)
  );
  CREATE TABLE IF NOT EXISTS booking_product_details (
    booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
    base_price INTEGER NOT NULL, discount_percent INTEGER NOT NULL, inclusions TEXT NOT NULL, setup_type TEXT NOT NULL
  );`);
  if (!db.prepare('PRAGMA table_info(product_details)').all().some(c=>c.name==='sale_price')) db.exec('ALTER TABLE product_details ADD COLUMN sale_price INTEGER CHECK(sale_price>=0)');
  db.exec(`CREATE TABLE IF NOT EXISTS services (name TEXT PRIMARY KEY COLLATE NOCASE, description TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO services(name) SELECT DISTINCT service FROM products;
    CREATE TABLE IF NOT EXISTS product_images (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, mime TEXT NOT NULL, content BLOB NOT NULL, alt TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id,position);
    CREATE TABLE IF NOT EXISTS product_reviews (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, author TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','hidden')), created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id,status,created_at);`);
  for(const [name,definition] of [['trending','INTEGER NOT NULL DEFAULT 0'],['admin_rating','REAL CHECK(admin_rating BETWEEN 1 AND 5)']]) {
    if(!db.prepare('PRAGMA table_info(product_details)').all().some(c=>c.name===name))db.exec('ALTER TABLE product_details ADD COLUMN '+name+' '+definition);
  }
  if(!db.prepare('PRAGMA table_info(services)').all().some(c=>c.name==='enabled'))db.exec('ALTER TABLE services ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))');
  if(!db.prepare('PRAGMA table_info(services)').all().some(c=>c.name==='discount_percent'))db.exec('ALTER TABLE services ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 100)');
  // Preserve old product percentage offers as fixed prices before retiring the field.
  db.exec('UPDATE product_details SET sale_price=COALESCE(sale_price,(SELECT ROUND(price*(100-product_details.discount_percent)/100.0) FROM products WHERE id=product_details.product_id)),discount_percent=NULL WHERE discount_percent IS NOT NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS order_enquiries (
    id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,customer_id TEXT NOT NULL REFERENCES customers(id),product_id TEXT REFERENCES products(id),
    product_name TEXT NOT NULL,service_name TEXT NOT NULL,amount INTEGER NOT NULL,phone TEXT NOT NULL,occasion TEXT NOT NULL,addons TEXT NOT NULL,custom_addon TEXT NOT NULL,
    message TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','confirmed','cancelled')),created_at TEXT NOT NULL
  );CREATE INDEX IF NOT EXISTS idx_enquiry_customer ON order_enquiries(customer_id);`);
  const insert = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  insert.run('store_discount','0');
  insert.run('store_season','default');
  for (const [key,value] of Object.entries({ timezone: process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata', leap_day_policy: process.env.LEAP_DAY_POLICY || 'feb28', retention_days: process.env.RETENTION_DAYS || '1095' })) insert.run(key,value);
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(archived,service,name,id)');
  if (!db.prepare("SELECT value FROM settings WHERE key='featured_initialized'").get() && db.prepare('SELECT id FROM products WHERE archived=0 LIMIT 1').get()) {
    transaction(db, () => {
      db.exec('INSERT OR IGNORE INTO featured_products(product_id) SELECT id FROM products WHERE archived=0 ORDER BY price,id LIMIT 3');
      insert.run('featured_initialized','true');
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
