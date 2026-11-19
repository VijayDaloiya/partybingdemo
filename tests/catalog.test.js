import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { listServices, serviceProducts, featuredProducts } from '../lib/catalog.js';
import { createAdmin } from '../lib/auth.js';
import { makeServer } from '../server.js';

function catalogDb() {
  const db=openDb(':memory:');
  const insert=db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?)');
  for(let i=0;i<105;i++) insert.run('birthday-'+i,'Birthday '+String(i).padStart(3,'0'),'A birthday package','Birthday Decoration',3000+i,'blush',0);
  insert.run('anniversary','Anniversary Florals','An anniversary package','Anniversary Decoration',8000,'gold',0);
  insert.run('archived','Archived Birthday','Unavailable','Birthday Decoration',100,'blush',1);
  for(let i=0;i<3;i++) db.prepare('INSERT INTO featured_products VALUES (?,?)').run('birthday-'+i,i);
  return db;
}

test('a 105-package service is paginated independently of the featured homepage',()=>{
  const db=catalogDb();try {
    assert.equal(listServices(db).find(s=>s.slug==='birthday-decoration').package_count,105);
    const first=serviceProducts(db,'birthday-decoration');
    assert.equal(first.items.length,12);assert.equal(first.total,105);assert.equal(first.page_count,9);
    assert.ok(first.items.every(p=>p.service==='Birthday Decoration' && !p.archived));
    const second=serviceProducts(db,'birthday-decoration','2');
    assert.ok(second.items.every(p=>!first.items.some(f=>f.id===p.id)));
    assert.equal(serviceProducts(db,'birthday-decoration','9').items.length,9);
    assert.equal(serviceProducts(db,'birthday-decoration','999').page,9);
    assert.equal(featuredProducts(db).length,3);
    assert.throws(()=>serviceProducts(db,'missing'),/not found/);
    assert.throws(()=>serviceProducts(db,'birthday-decoration','-1'),/valid page/);
  }finally{db.close();}
});

test('public catalog routes, deep links and admin featured controls',async()=>{
  const db=catalogDb();createAdmin(db,{name:'Owner',email:'owner@example.com',password:'Test-catalog-password',role:'owner'});
  const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    let r=await fetch(base+'/api/products?featured=true');assert.equal((await r.json()).length,3);
    r=await fetch(base+'/api/catalog?service=birthday-decoration&page=2');const result=await r.json();assert.equal(result.page,2);assert.equal(result.items.length,12);
    r=await fetch(base+'/services/birthday-decoration?page=2');assert.equal(r.status,200);assert.match(await r.text(),/app.js/);
    r=await fetch(base+'/api/catalog?service=missing');assert.equal(r.status,404);
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'Test-catalog-password'})});
    const credentials=await login.json();
    const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':credentials.csrf};
    const patch=(id,data)=>fetch(base+'/api/admin/products/'+id,{method:'PATCH',headers,body:JSON.stringify(data)});
    for(let i=3;i<6;i++)assert.equal((await patch('birthday-'+i,{featured:true})).status,200);
    assert.equal((await patch('birthday-6',{featured:true})).status,400);
    assert.equal((await patch('birthday-0',{archived:true})).status,200);
    assert.equal(featuredProducts(db).length,5);
    assert.equal((await patch('birthday-6',{featured:true})).status,200);
    assert.equal((await patch('birthday-1',{featured:false})).status,200);
    assert.equal(db.prepare('SELECT archived FROM products WHERE id=?').get('birthday-1').archived,0);
    assert.equal(featuredProducts(db).length,5);
  }finally{await new Promise(r=>server.close(r));db.close();}
});
