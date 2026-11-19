import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.js';
import {pricedProduct,saveDetails,percentage} from '../lib/storefront.js';
import {listServices,featuredProducts} from '../lib/catalog.js';
import {createBooking} from '../lib/crm.js';
import {createAdmin} from '../lib/auth.js';
import {makeServer} from '../server.js';
const product={name:'Birthday',description:'Balloon backdrop',service:'Birthday Decoration',price:4999,theme:'blush',inclusions:'20 balloons\nBackdrop',setup_type:'wall',discount_percent:null};
function fixture(){const db=openDb(':memory:');db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,0)').run('p',product.name,product.description,product.service,product.price,product.theme);saveDetails(db,'p',product);db.prepare("INSERT INTO featured_products VALUES ('p',0)").run();return db;}
const booking={full_name:'Test',phone:'+12025550123',city:'Delhi',product_id:'p',occasion_type:'Birthday',occasion_date:'2026-12-01',event_date:'2026-12-01'};
test('discount precedence, zero override, rounding, bounds and catalog starting prices',()=>{
 const db=fixture();try{
  db.prepare("UPDATE settings SET value='10' WHERE key='store_discount'").run();
  const p=db.prepare("SELECT * FROM products WHERE id='p'").get();
  assert.equal(pricedProduct(db,p).final_price,4499);assert.equal(listServices(db)[0].starting_price,4499);assert.equal(featuredProducts(db)[0].final_price,4499);
  saveDetails(db,'p',{...product,sale_price:3000});assert.equal(pricedProduct(db,p).final_price,4499);
  db.prepare("INSERT INTO services(name,discount_percent) VALUES ('Birthday Decoration',25)").run();
  assert.equal(pricedProduct(db,p).final_price,3749);assert.equal(listServices(db)[0].starting_price,3749);
  db.prepare("UPDATE services SET discount_percent=100").run();assert.equal(pricedProduct(db,p).final_price,0);
  db.prepare("UPDATE services SET discount_percent=0").run();assert.equal(pricedProduct(db,p).final_price,4499);
  db.prepare("UPDATE settings SET value='0' WHERE key='store_discount'").run();assert.equal(pricedProduct(db,p).final_price,3000);
  saveDetails(db,'p',{...product,sale_price:null});assert.equal(pricedProduct(db,p).final_price,4999);
  for(const value of [-1,101,1.5,'10',null,NaN])assert.throws(()=>percentage(value),/whole percentage/);
 }finally{db.close();}
});
test('bookings use server price and preserve product details after edits; stale quotes create no booking',()=>{
 const db=fixture();try{
  db.prepare("UPDATE settings SET value='20' WHERE key='store_discount'").run();
  assert.throws(()=>createBooking(db,{...booking,expected_price:4999}),/price has changed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,0);
  const result=createBooking(db,{...booking,expected_price:3999,amount:1});
  saveDetails(db,'p',{...product,inclusions:'Changed',setup_type:'stand',sale_price:2500});
  db.prepare("UPDATE products SET price=9999,name='Changed' WHERE id='p'").run();
  const saved=db.prepare('SELECT * FROM bookings WHERE id=?').get(result.id);assert.equal(saved.amount,3999);assert.equal(saved.product_name,'Birthday');
  const details=db.prepare('SELECT * FROM booking_product_details WHERE booking_id=?').get(result.id);assert.equal(details.inclusions,product.inclusions);assert.equal(details.setup_type,'wall');assert.equal(details.discount_percent,20);
 }finally{db.close();}
});
test('admin merchandising routes require auth and CSRF, validate atomically, and persist product edits and themes',async()=>{
 const db=fixture();createAdmin(db,{name:'Admin',email:'admin@example.com',password:'Testing-storefront-42',role:'admin'});
 const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/admin/storefront')).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'Testing-storefront-42'})});const auth=await login.json();
  const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':auth.csrf};
  const patch=(path,data,h=headers)=>fetch(base+path,{method:'PATCH',headers:h,body:JSON.stringify(data)});
  assert.equal((await patch('/api/admin/storefront',{discount_percent:10,season:'diwali'},{...headers,'X-CSRF-Token':''})).status,403);
  for(const season of ['new-year','wedding-season','janmashtami','diwali','default']){
   assert.equal((await patch('/api/admin/storefront',{discount_percent:10,season})).status,200);
   assert.deepEqual(await (await fetch(base+'/api/site')).json(),{discount_percent:10,season});
  }
  assert.equal((await patch('/api/admin/storefront',{discount_percent:30,season:'invalid'})).status,400);
  assert.equal((await (await fetch(base+'/api/site')).json()).discount_percent,10);
  assert.equal((await patch('/api/admin/products/p',{...product,price:-1})).status,400);
  assert.equal((await patch('/api/admin/products/p',{...product,name:'Edited Birthday',sale_price:4249,trending:true,admin_rating:4.5,setup_type:'stand'})).status,200);
  let p=(await (await fetch(base+'/api/products?featured=true')).json())[0];assert.equal(p.name,'Edited Birthday');assert.equal(p.final_price,4499);assert.equal(p.trending,1);assert.equal(p.admin_rating,4.5);assert.equal(p.rating,null);assert.equal(p.setup_type,'stand');assert.equal(p.inclusions,product.inclusions);
  assert.equal((await patch('/api/admin/products/p',{...product,discount_percent:null})).status,200);
  p=(await (await fetch(base+'/api/products')).json())[0];assert.equal(p.final_price,4499);
  assert.equal((await patch('/api/admin/products/p',{...product,discount_percent:10})).status,400);
  assert.equal((await patch('/api/admin/products/p',{...product,admin_rating:5.1})).status,400);
  assert.equal((await patch('/api/admin/services',{name:product.service,discount_percent:30},{...headers,'X-CSRF-Token':''})).status,403);
  assert.equal((await patch('/api/admin/services',{name:product.service,discount_percent:30})).status,200);
  assert.equal((await (await fetch(base+'/api/products')).json())[0].final_price,3499);
  assert.equal((await patch('/api/admin/services',{name:product.service,discount_percent:101})).status,400);
  assert.equal((await patch('/api/admin/services',{name:product.service,discount_percent:0})).status,200);
  const added=await fetch(base+'/api/admin/products',{method:'POST',headers,body:JSON.stringify({...product,name:'New package',setup_type:'both'})});assert.equal(added.status,201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_details').get().n,2);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
