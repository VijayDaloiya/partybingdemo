import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.DATABASE_PATH || './data/party-bing.sqlite';
const db = new DatabaseSync(dbPath);

db.exec('DELETE FROM featured_products;');
const top = db.prepare(`
  WITH ranked AS (
    SELECT p.id, ROW_NUMBER() OVER (PARTITION BY p.service ORDER BY p.id) as rn
    FROM products p
    JOIN product_images i ON i.product_id = p.id
    WHERE p.archived = 0
  )
  SELECT id FROM ranked WHERE rn = 1 LIMIT 6
`).all();

const insert = db.prepare('INSERT INTO featured_products (product_id, position) VALUES (?, ?)');
top.forEach((t, i) => insert.run(t.id, i));
console.log(`Updated featured products to ${top.length} packages with images.`);
