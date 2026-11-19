import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.js';
import {budgetProducts} from '../lib/catalog.js';
import {saveDetails} from '../lib/storefront.js';
test('budget browsing filters current prices and category, excludes archived products, and paginates',()=>{
 const db=openDb(':memory:');try{
  const insert=db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?)');
  for(let n=0;n<27;n++)insert.run('b'+n,'Birthday '+n,'Decor','Birthday',2000+n,'blush',0);
  insert.run('sale','Sale','Decor','Wedding',5000,'gold',0);saveDetails(db,'sale',{inclusions:'Decor',setup_type:'stand',sale_price:1998});
  insert.run('boundary','Boundary','Decor','Wedding',1999,'gold',0);insert.run('archived','Archived','Decor','Wedding',100,'gold',1);
  const browse=s=>budgetProducts(db,new URLSearchParams(s));
  assert.deepEqual(browse('under=1999').items.map(p=>p.id),['sale']);
  db.prepare("UPDATE settings SET value='10' WHERE key='store_discount'").run();
  assert.equal(browse('under=1999').total,28);assert.ok(browse('under=1999').items.every(p=>p.final_price<1999));
  const first=browse('under=1999&service=birthday'),second=browse('under=1999&service=birthday&page=2');assert.equal(first.total,27);assert.equal(first.page_count,3);assert.equal(first.items.length,12);assert.ok(second.items.every(p=>!first.items.some(x=>x.id===p.id)));
  assert.equal(browse('under=1999&service=birthday&page=3').items.length,3);
  db.prepare("INSERT INTO services(name,discount_percent) VALUES ('Wedding',70)").run();assert.equal(browse('under=1999&service=wedding').total,2);
  assert.equal(browse('under=1').total,0);assert.equal(browse('under=1').page,1);
  for(const q of ['under=-1','under=no','page=0','under=1.5','service=missing'])assert.throws(()=>browse(q));
 }finally{db.close();}
});
