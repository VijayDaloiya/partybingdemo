import { openDb, transaction } from '../lib/db.js';
const db=openDb();
try {
  if(db.prepare("SELECT value FROM settings WHERE key='demonstration_data'").get()?.value!=='true') throw new Error('Sample product details require the sample database.');
  const details=[
    ['Blush & Bloom','wall','Soft pink balloon arrangement\nFloral accents\nWall-mounted birthday backdrop'],
    ['Golden Hour','stand','Gold celebration backdrop\nFreestanding backdrop support\nWarm decorative lighting'],
    ['A Little Wonder','stand','Pastel balloon arrangement\nBaby shower backdrop\nFreestanding backdrop support'],
    ['Midnight Sparkle','wall','Navy and silver balloon arrangement\nShimmering decorative lights\nWall-mounted birthday backdrop'],
    ['Garden of Love','stand','Floral anniversary backdrop\nSoft decorative lighting\nFreestanding backdrop support'],
    ['Little Sunshine','wall','Pastel yellow balloon arrangement\nBaby shower wall backdrop'],
    ['The Grand Toast','stand','Gold and ivory decorative arrangement\nCorporate celebration backdrop\nFreestanding backdrop support'],
  ];
  let added=0;
  transaction(db,()=>{for(const [name,setup,inclusions] of details){
    const p=db.prepare('SELECT id FROM products WHERE name=?').get(name);if(!p)continue;
    added+=Number(db.prepare('INSERT OR IGNORE INTO product_details(product_id,inclusions,setup_type,discount_percent) VALUES (?,?,?,NULL)').run(p.id,inclusions,setup).changes);
  }});
  console.log(`Added inclusion lists and setup types to ${added} sample products.`);
}finally{db.close();}
