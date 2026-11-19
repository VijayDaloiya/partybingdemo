import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.js';
import {createAdmin} from '../lib/auth.js';
import {makeServer} from '../server.js';
import {createEnquiry} from '../lib/enquiries.js';

test('service visibility round trip preserves products, photos, offers, featured picks and enquiries',async()=>{
 const db=openDb(':memory:');
 db.prepare("INSERT INTO services(name,discount_percent) VALUES ('Birthday',10)").run();
 db.prepare("INSERT INTO products VALUES ('prod','Birthday party','Balloons','Birthday',2000,'blush',0)").run();
 db.prepare("INSERT INTO featured_products VALUES ('prod',0)").run();
 db.prepare("INSERT INTO product_details(product_id,inclusions,setup_type,sale_price) VALUES ('prod','Balloons and backdrop','wall',1800)").run();
 db.prepare("INSERT INTO product_images VALUES ('photo','prod','image/jpeg',?,'Cover',0)").run(Buffer.from('saved photo'));
 const enquiry={request_id:'12345678-1234-1234-1234-123456789012',product_id:'prod',phone:'9876543210',occasion:'Birthday',addons:[],custom_addon:'',expected_price:1800};
 createEnquiry(db,enquiry);
 const tables=['products','product_details','product_images','featured_products','order_enquiries'];
 const before=tables.map(t=>db.prepare('SELECT * FROM '+t).all());
 createAdmin(db,{name:'Owner',email:'owner@example.com',password:'Service-test-password',role:'owner'});
 const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'Service-test-password'})});
  const {csrf}=await login.json();const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':csrf};
  const toggle=enabled=>fetch(base+'/api/admin/services',{method:'PATCH',headers,body:JSON.stringify({name:'Birthday',enabled})});
  assert.equal((await toggle('false')).status,400);
  assert.equal((await toggle(false)).status,200);
  for(const path of ['/api/services','/api/products','/api/products?featured=true'])assert.deepEqual(await (await fetch(base+path)).json(),[]);
  assert.equal((await (await fetch(base+'/api/browse?under=2999')).json()).total,0);
  assert.equal((await fetch(base+'/api/catalog?service=birthday')).status,404);
  assert.equal((await fetch(base+'/api/products/prod/reviews')).status,404);
  assert.throws(()=>createEnquiry(db,{...enquiry,request_id:'22345678-1234-1234-1234-123456789012'}),/no longer available/);
  const adminServices=await(await fetch(base+'/api/admin/services',{headers})).json();
  assert.equal(adminServices[0].enabled,0);assert.equal(adminServices[0].package_count,1);assert.equal(adminServices[0].discount_percent,10);
  assert.equal((await(await fetch(base+'/api/admin/products',{headers})).json()).length,1);
  assert.equal((await toggle(true)).status,200);
  assert.equal((await(await fetch(base+'/api/products?featured=true')).json()).length,1);
  assert.equal((await(await fetch(base+'/api/catalog?service=birthday')).json()).total,1);
  assert.deepEqual(tables.map(t=>db.prepare('SELECT * FROM '+t).all()),before);
  const logo=await fetch(base+'/logo.jpeg');assert.equal(logo.headers.get('content-type'),'image/jpeg');assert.ok((await logo.arrayBuffer()).byteLength>1000);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
