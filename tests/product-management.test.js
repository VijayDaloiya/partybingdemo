import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.js';
import {createAdmin} from '../lib/auth.js';
import {makeServer} from '../server.js';
import {createBooking} from '../lib/crm.js';
import {validateImages} from '../lib/product-images.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG7sAAAAASUVORK5CYII=';
const product={product_id:'TEST-001',name:'Test florals',service:'Wedding Decoration',price:5000,sale_price:4200,discount_percent:null,description:'Floral backdrop',inclusions:'Flowers\nStand',setup_type:'stand',theme:'blush',images:[{data_url:png,alt:'Floral view 1'},{data_url:png,alt:'Floral view 2'}]};
test('services, product IDs, fixed prices, multiple images and moderated reviews work end to end',async()=>{
 const db=openDb(':memory:');createAdmin(db,{name:'Admin',email:'admin@example.com',password:'Test-catalog-admin-42',role:'admin'});
 const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(path,method='GET',data,headers={})=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});
 try {
  assert.equal((await request('/admin/services','POST',{name:'Wedding Decoration'})).status,401);
  const login=await request('/login','POST',{email:'admin@example.com',password:'Test-catalog-admin-42'});const credentials=await login.json();const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':credentials.csrf};
  const write=(path,data,method='POST')=>request(path,method,data,headers);
  assert.equal((await write('/admin/services',{name:'Wedding Decoration',description:'Wedding celebrations'})).status,201);
  assert.equal((await write('/admin/services',{name:'wedding decoration'})).status,409);
  const empty=await (await request('/catalog?service=wedding-decoration')).json();assert.equal(empty.total,0);assert.equal(empty.page,1);assert.deepEqual(empty.items,[]);
  assert.equal((await write('/admin/products',{...product,service:'Missing'})).status,400);
  assert.equal((await write('/admin/products',{...product,sale_price:5001})).status,400);
  assert.equal((await write('/admin/products',{...product,discount_percent:20})).status,400);
  assert.equal((await write('/admin/products',product)).status,201);
  assert.equal((await write('/admin/products',product)).status,409);
  let p=(await (await request('/products')).json())[0];assert.equal(p.final_price,4200);assert.equal(p.images.length,2);assert.equal(p.rating,null);assert.equal(p.review_count,0);
  assert.equal((await (await request('/services')).json())[0].starting_price,4200);
  const image=await fetch(base+p.images[0].url);assert.equal(image.headers.get('content-type'),'image/png');assert.ok((await image.arrayBuffer()).byteLength>12);
  const oldImage=p.images[0];
  assert.equal((await write('/admin/products',{...product,product_id:'TEST-002',images:[{id:oldImage.id}]})).status,400);
  assert.equal(db.prepare("SELECT id FROM products WHERE id='TEST-002'").get(),undefined);
  assert.equal((await write('/admin/products/TEST-001',{...product,name:'Updated',images:[{id:p.images[1].id}]},'PATCH')).status,200);
  assert.equal((await fetch(base+oldImage.url)).status,404);
  p=(await (await request('/products')).json())[0];assert.equal(p.images.length,1);assert.equal(p.name,'Updated');
  db.prepare("UPDATE settings SET value='50' WHERE key='store_discount'").run();
  const booking=createBooking(db,{product_id:p.id,full_name:'Test',phone:'+12025550123',city:'Delhi',occasion_type:'Wedding',occasion_date:'2026-12-01',event_date:'2026-12-01',expected_price:2500});
  assert.equal(db.prepare('SELECT amount FROM bookings WHERE id=?').get(booking.id).amount,2500);
  assert.equal((await request('/products/TEST-001/reviews','POST',{author:'Customer',rating:6,body:'Nice'})).status,400);
  assert.equal((await request('/products/TEST-001/reviews','POST',{author:'Customer',rating:4,body:'A lovely arrangement.'})).status,201);
  assert.deepEqual(await (await request('/products/TEST-001/reviews')).json(),[]);
  assert.equal((await (await request('/products')).json())[0].review_count,0);
  const reviews=await (await request('/admin/reviews','GET',undefined,headers)).json();assert.equal(reviews[0].status,'pending');
  assert.equal((await request('/admin/reviews/'+reviews[0].id,'PATCH',{status:'approved'})).status,401);
  assert.equal((await write('/admin/reviews/'+reviews[0].id,{status:'approved'},'PATCH')).status,200);
  assert.equal((await (await request('/products')).json())[0].rating,4);
  assert.equal((await (await request('/products/TEST-001/reviews')).json()).length,1);
  assert.equal((await write('/admin/reviews/'+reviews[0].id,{status:'hidden'},'PATCH')).status,200);
  assert.equal((await (await request('/products')).json())[0].review_count,0);
  assert.equal((await write('/admin/products/TEST-001',{...product,images:[],sale_price:null,discount_percent:null},'PATCH')).status,200);
  p=(await (await request('/products')).json())[0];assert.equal(p.final_price,2500);assert.deepEqual(p.images,[]);
  assert.equal(db.prepare('SELECT amount FROM bookings WHERE id=?').get(booking.id).amount,2500);
 }finally {await new Promise(r=>server.close(r));db.close();}
});
test('image validation rejects spoofed content, SVG, oversized images and excess images',()=>{
 const db=openDb(':memory:');try{
  assert.throws(()=>validateImages(db,'p',[{data_url:'data:image/png;base64,'+Buffer.from('Not an image file').toString('base64')}]),/does not match/);
  assert.throws(()=>validateImages(db,'p',[{data_url:'data:image/svg+xml;base64,PHN2Zz4='}]),/JPG, PNG/);
  assert.throws(()=>validateImages(db,'p',Array(7).fill({data_url:png})),/up to 6/);
  assert.throws(()=>validateImages(db,'p',[{data_url:'data:image/png;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64')}]),/2 MB/);
 }finally{db.close();}
});
