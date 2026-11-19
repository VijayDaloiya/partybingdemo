import {id,now,text,fail,normalizePhone,audit} from './crm.js';
import {transaction} from './db.js';
import {pricedProduct,serviceEnabled} from './storefront.js';
export const addons=['Photography','Mascot Man','Popcorn stall','Portrait Artist','Game Stall','Stilt Walker','Puppet Show','DJ Sound','Magic Show','Tattoo Maker','Game Host','Mimicry Artist','Mehandi','Chocolate Fountain','Balloon Toy Artist','Jumping Jank','Sugar Candy','Caricature'];
export const businessWhatsApp='917385622113';

function formatEnquiryDate(d){
  if(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)){
    const [y,m,day]=d.split('-');
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${Number(day)} ${months[Number(m)-1]} ${y}`;
  }
  return d||'';
}

export function createEnquiry(db,data){
 const phone=normalizePhone(data.phone),occasion=text(data.occasion,'occasion',100,true),custom=text(data.custom_addon,'other request',1000);
 const eventDate=typeof data.event_date==='string'?data.event_date.trim().slice(0,30):'';
 if(!Array.isArray(data.addons)||data.addons.length>addons.length||data.addons.some(a=>!addons.includes(a)))fail('Choose add-ons from the available list.');
 const selected=[...new Set(data.addons)];
 const key=text(data.request_id,'request reference',64,true);if(!/^[a-zA-Z0-9-]{20,64}$/.test(key))fail('Invalid request reference. Please reopen the order panel.');
 const productId=text(data.product_id,'product',64,true);
 const payload=JSON.stringify({phone,occasion,event_date:eventDate,custom,selected,productId,expected_price:data.expected_price});
 const existing=db.prepare('SELECT * FROM order_enquiries WHERE request_id=?').get(key);
 const result=row=>({id:row.id,whatsapp_url:'https://wa.me/'+businessWhatsApp+'?text='+encodeURIComponent(row.message),message:row.message});
 if(existing){if(existing.payload!==payload)fail('This request has already been saved. Reopen the order panel for a new enquiry.',409);return result(existing);}
 const product=db.prepare('SELECT * FROM products WHERE id=? AND archived=0').get(productId);if(!product || !serviceEnabled(db,product.service))fail('This product is no longer available.',404);
 const quote=pricedProduct(db,product);
 if(Number(data.expected_price)!==quote.final_price)fail('The price changed. Close this panel and refresh to review the latest price.',409);
 return transaction(db,()=>{
  let customer=db.prepare('SELECT id FROM customers WHERE deleted_at IS NULL AND (normalized_phone=? OR id IN (SELECT customer_id FROM customer_phone_aliases WHERE normalized_phone=?))').get(phone,phone);
  if(!customer){customer={id:id()};db.prepare('INSERT INTO customers(id,full_name,normalized_phone,created_at,updated_at) VALUES (?,?,?,?,?)').run(customer.id,'Website enquiry',phone,now(),now());}
  const enquiryId=id();
  const formattedDate=eventDate?formatEnquiryDate(eventDate):'';
  const lines=[
    `Hello Party Bing! I’d like to enquire about:`,
    `🎈 Package: ${product.name} (₹${quote.final_price.toLocaleString('en-IN')})`,
    formattedDate?`📅 Event Date: ${formattedDate}`:null,
    `✨ Occasion: ${occasion}`,
    selected.length?`➕ Add-ons: ${selected.join(', ')}`:null,
    custom?`📝 Special request: ${custom}`:null,
    `\nPlease confirm availability and details.`,
    `Ref: ${enquiryId}`
  ].filter(Boolean);
  const message=lines.join('\n');
  db.prepare('INSERT INTO order_enquiries(id,request_id,customer_id,product_id,product_name,service_name,amount,phone,occasion,addons,custom_addon,message,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(enquiryId,key,customer.id,product.id,product.name,product.service,quote.final_price,phone,occasion,JSON.stringify(selected),custom,message,payload,now());
  db.prepare('INSERT INTO customer_interactions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),customer.id,null,null,'website_enquiry','new',message,null,null,now());
  db.prepare('UPDATE customers SET updated_at=? WHERE id=?').run(now(),customer.id);
  return result({id:enquiryId,message});
 });
}
export function listEnquiries(db){return db.prepare('SELECT e.*,c.full_name FROM order_enquiries e JOIN customers c ON c.id=e.customer_id WHERE c.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 500').all().map(({payload,request_id,...e})=>({...e,addons:JSON.parse(e.addons)}));}
export function updateEnquiry(db,enquiryId,status,admin){
 if(!['new','contacted','confirmed','cancelled'].includes(status))fail('Choose a valid enquiry status.');
 if(!db.prepare('SELECT id FROM order_enquiries WHERE id=?').get(enquiryId))fail('Enquiry not found.',404);
 transaction(db,()=>{db.prepare('UPDATE order_enquiries SET status=? WHERE id=?').run(status,enquiryId);audit(db,admin,'enquiry.'+status,enquiryId);});
}
