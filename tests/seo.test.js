import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.js';
import {puneAreas,seoResource,locationPage,catalogFallback} from '../lib/seo.js';
test('crawler resources include locality directory and only enabled services',()=>{
 const db=openDb(':memory:');
 try{
  db.prepare("INSERT INTO services(name) VALUES ('Birthday Decoration')").run();
  db.prepare("INSERT INTO products VALUES ('seo-product','Test <decoration>','Balloons','Birthday Decoration',5000,'blush',0)").run();
  assert.ok(new Set(Object.values(puneAreas).flat()).size>=100);
  assert.equal(seoResource(db,'/robots.txt').type,'text/plain');
  assert.match(seoResource(db,'/robots.txt').body,/Disallow: \/admin/);
  assert.match(seoResource(db,'/sitemap.xml').body,/birthday-decoration/);
  assert.match(seoResource(db,'/llms.txt').body,/Read-only catalog/);
  assert.match(locationPage(db),/Decoration in Wakad/);
  assert.match(locationPage(db),/Decoration in Baner/);
  assert.match(catalogFallback(db,new URL('http://localhost/services/birthday-decoration')),/Test &lt;decoration&gt;/);
  db.prepare('UPDATE services SET enabled=0').run();
  assert.doesNotMatch(seoResource(db,'/sitemap.xml').body,/birthday-decoration/);
  assert.throws(()=>catalogFallback(db,new URL('http://localhost/services/birthday-decoration')),/not found/);
 }finally{db.close();}
});
