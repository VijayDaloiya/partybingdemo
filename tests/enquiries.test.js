import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.js';
import {addons,createEnquiry,listEnquiries,businessWhatsApp} from '../lib/enquiries.js';
import {createAdmin} from '../lib/auth.js';
import {eraseCustomer,customerProfile,mergeCustomers} from '../lib/crm.js';
import {makeServer} from '../server.js';
function fixture(){const db=openDb(':memory:');db.prepare("INSERT INTO products VALUES ('prod','Party package','Decorations','Birthday Decoration',5000,'blush',0)").run();return db;}
const data={request_id:'12345678-1234-1234-1234-123456789012',product_id:'prod',phone:'9876543210',occasion:'Birthday',addons:['Photography','Magic Show'],custom_addon:'Blue balloon arch',expected_price:5000};
test('minimal enquiries snapshot every selection, save the identical WhatsApp message, and retry without duplicates',()=>{
 const db=fixture();try{
  assert.equal(addons.length,18);assert.equal(new Set(addons).size,18);
  const result=createEnquiry(db,data);const row=listEnquiries(db)[0];
  assert.equal(row.phone,'+919876543210');assert.equal(row.status,'new');assert.equal(row.amount,5000);assert.deepEqual(row.addons,data.addons);assert.equal(row.custom_addon,data.custom_addon);
  const url=new URL(result.whatsapp_url);assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/'+businessWhatsApp);assert.equal(url.searchParams.get('text'),row.message);
  assert.match(row.message,/Photography, Magic Show/);assert.match(row.message,/Blue balloon arch/);
  assert.equal(createEnquiry(db,data).id,result.id);assert.equal(listEnquiries(db).length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customer_interactions').get().n,1);
  assert.equal(db.prepare('SELECT marketing_consent FROM customers').get().marketing_consent,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customer_occasions').get().n,0);
  assert.match(customerProfile(db,row.customer_id).interactions[0].notes,/Blue balloon arch/);
  assert.throws(()=>createEnquiry(db,{...data,custom_addon:'Changed'}),/already been saved/);
  db.prepare("UPDATE products SET name='New name',price=9000 WHERE id='prod'").run();assert.equal(listEnquiries(db)[0].product_name,'Party package');assert.equal(listEnquiries(db)[0].amount,5000);
 }finally{db.close();}
});
test('invalid and stale enquiries write nothing; erasure clears enquiry contact details',()=>{
 const db=fixture();try{
  for(const patch of [{addons:['Unknown']},{phone:'abc'},{occasion:''},{expected_price:1},{request_id:'bad'}])assert.throws(()=>createEnquiry(db,{...data,...patch}));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,0);
  createEnquiry(db,{...data,addons:[],custom_addon:''});const customer=listEnquiries(db)[0].customer_id;
  createAdmin(db,{name:'Owner',email:'owner@example.com',password:'Test-only-enquiry-42',role:'owner'});
  eraseCustomer(db,customer,db.prepare('SELECT id FROM admins').get().id);
  const row=db.prepare('SELECT * FROM order_enquiries').get();assert.equal(row.phone,'');assert.equal(row.message,'');assert.equal(row.payload,'');assert.deepEqual(listEnquiries(db),[]);
 }finally{db.close();}
});
test('public enquiry API and protected admin queue/status work end to end',async()=>{
 const db=fixture();createAdmin(db,{name:'Admin',email:'admin@example.com',password:'Test-only-enquiry-42',role:'admin'});const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const req=(path,method='GET',body,headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await (await req('/addons')).json()).items.length,18);
  const response=await req('/enquiries','POST',data);assert.equal(response.status,201);const result=await response.json();
  assert.equal((await req('/admin/enquiries')).status,401);
  const login=await req('/login','POST',{email:'admin@example.com',password:'Test-only-enquiry-42'});const auth=await login.json();const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':auth.csrf};
  const rows=await (await req('/admin/enquiries','GET',undefined,headers)).json();assert.equal(rows[0].id,result.id);assert.equal(rows[0].payload,undefined);
  assert.equal((await req('/admin/enquiries/'+result.id,'PATCH',{status:'contacted'},{...headers,'X-CSRF-Token':''})).status,403);
  assert.equal((await req('/admin/enquiries/'+result.id,'PATCH',{status:'contacted'},headers)).status,200);
  assert.equal(listEnquiries(db)[0].status,'contacted');assert.equal((await req('/admin/enquiries/'+result.id,'PATCH',{status:'sent'},headers)).status,400);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
