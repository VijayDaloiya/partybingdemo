import { addons, businessWhatsApp, createEnquiry, listEnquiries, updateEnquiry } from './lib/enquiries.js';
import { validateImages, saveImages } from './lib/product-images.js';
import { storefront, pricedProduct, productInput, saveDetails, percentage, seasons } from './lib/storefront.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import {seoResource,locationPage,catalogFallback,siteOrigin} from './lib/seo.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from './lib/db.js';
import { listServices, featuredProducts, serviceProducts, serviceSlug, budgetProducts } from './lib/catalog.js';
import { login, session } from './lib/auth.js';
import { createBooking, runReminders, metrics, listReminders, customers, customerProfile, reminderAction, whatsappMessage, mergeCustomers, eraseCustomer, optOut, getSettings, todayInZone, validDate, text, fail, id, now, hash, audit, addDays } from './lib/crm.js';

try { process.loadEnvFile(); } catch (e) { if (e.code!=='ENOENT') throw e; }
const root=dirname(fileURLToPath(import.meta.url));
export function makeServer(db) {
  const limits=new Map();
  function rate(req,key,max) {
    const k=`${req.socket.remoteAddress}:${key}`, old=limits.get(k), entry=old && old.until>Date.now()?old:{count:0,until:Date.now()+15*60000};
    entry.count++; limits.set(k,entry); if (entry.count>max) fail('Too many attempts. Please try again in 15 minutes.',429);
    if (limits.size>5000) for (const [key,v] of limits) if (v.until<Date.now()) limits.delete(key);
  }
  return createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'), p=url.pathname, method=req.method;
    const send=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('Permissions-Policy','microphone=(), camera=(), geolocation=()');
    try {
      if (!p.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(method)) fail('Method not allowed.',405);
        const resource=seoResource(db,p);
        if(resource){res.writeHead(200,{'Content-Type':resource.type+'; charset=utf-8','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:resource.body);return;}
        const file=p==='/logo.jpeg'?'logo.jpeg':p==='/app.js'?'app.js':p==='/style.css'?'style.css':p==='/theme.css'?'theme.css':'index.html';
        let content=await readFile(resolve(root,'public',file));
        if(file==='index.html'){
          const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
          content=content.toString();
          const directory=p==='/pune-decoration';
          if(directory)content=content.replace('<script type="module" src="/app.js"></script>','');
          const fallback=directory?locationPage(db):(catalogFallback(db,url)?`<noscript>${catalogFallback(db,url)}</noscript>`:'');
          content=content.replace('<div id="app"></div>',`<div id="app">${fallback}</div>`);
          const publicPage=['/','/packages','/pune-decoration'].includes(p)||p.startsWith('/services/');
          if(publicPage){
            const title=directory?'Balloon decoration in Pune — Localities & enquiries | Party Bing':p.startsWith('/services/')?p.slice(10).replaceAll('-',' ')+' in Pune | Party Bing':'Party Bing | Balloon & birthday decoration in Pune';
            const description='Explore Party Bing decoration packages in Pune and Pimpri-Chinchwad, including Wakad, Baner and nearby localities. Contact the team to confirm your date and venue.';
            const query=p.startsWith('/services/')&&url.searchParams.get('page')&&url.searchParams.get('page')!=='1'?'?page='+encodeURIComponent(url.searchParams.get('page')):'';
            content=content.replace(/<title>.*?<\/title>/,`<title>${escape(title)}</title>`).replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${escape(description)}">`).replace('</head>',`<link rel="canonical" href="${escape(siteOrigin()+p+query)}"></head>`);
          }else res.setHeader('X-Robots-Tag','noindex, nofollow');
        }
        const contentType = file.endsWith('.jpeg') ? 'image/jpeg' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8';
        const cacheControl = file === 'index.html' ? 'no-cache' : 'public, max-age=86400';
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
        res.end(method === 'HEAD' ? undefined : content);
        return;
      }
      let data={};
      if (['POST','PATCH','DELETE'].includes(method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) fail('JSON required.',415);
        // Block cross-origin writes even on public endpoints; admin writes also require CSRF.
        if (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) fail('Cross-origin request rejected.',403);
        const productWrite=/^\/api\/admin\/products(?:\/[^/]+)?$/.test(p) && ['POST','PATCH'].includes(method);
        if(productWrite){const a=session(db,req);if(!a)fail('Please sign in to continue.',401);if(req.headers['x-csrf-token']!==a.csrf)fail('Session verification failed.',403);}
        const maxBytes=productWrite?17*1024*1024:32768;
        let body='';for await (const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>maxBytes) fail('Request too large.',413);}
        try {data=body?JSON.parse(body):{};} catch {fail('Invalid JSON.');}
        if (!data || typeof data!=='object' || Array.isArray(data)) fail('Invalid request.');
      }
      const imageMatch=p.match(/^\/api\/images\/([a-zA-Z0-9-]+)$/);
      if(imageMatch && ['GET','HEAD'].includes(method)){
        const etag = `"${imageMatch[1]}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { 'Cache-Control': 'public, max-age=2592000, immutable', 'ETag': etag });
          res.end();
          return;
        }
        const image=db.prepare('SELECT i.mime,i.content FROM product_images i JOIN products p ON p.id=i.product_id WHERE i.id=? AND p.archived=0').get(imageMatch[1]);
        if(!image)fail('Image not found.',404);
        res.writeHead(200,{
          'Content-Type': image.mime,
          'Cache-Control': 'public, max-age=2592000, immutable',
          'ETag': etag,
          'Content-Length': image.content.length
        });
        res.end(Buffer.from(image.content));
        return;
      }
      const publicReview=p.match(/^\/api\/products\/([^/]+)\/reviews$/);
      if(publicReview && ['GET','POST'].includes(method)){
        if(!db.prepare('SELECT id FROM products WHERE id=? AND archived=0 AND NOT EXISTS(SELECT 1 FROM services s WHERE s.name=products.service AND s.enabled=0)').get(publicReview[1]))fail('Product not found.',404);
        if(method==='GET')return send(200,db.prepare("SELECT author,rating,body,created_at FROM product_reviews WHERE product_id=? AND status='approved' ORDER BY created_at DESC LIMIT 100").all(publicReview[1]));
        rate(req,'review',5);
        if(!Number.isInteger(data.rating)||data.rating<1||data.rating>5)fail('Choose a rating from 1 to 5.');
        const author=text(data.author,'name',100,true),body=text(data.body,'review',2000,true);
        db.prepare('INSERT INTO product_reviews(id,product_id,author,rating,body,created_at) VALUES (?,?,?,?,?,?)').run(id(),publicReview[1],author,data.rating,body,now());
        return send(201,{ok:true,message:'Thank you. Your review is awaiting approval.'});
      }
      if (p==='/api/products' && method==='GET') return send(200,url.searchParams.get('featured')==='true' ? featuredProducts(db) : db.prepare('SELECT * FROM products WHERE archived=0 AND NOT EXISTS(SELECT 1 FROM services s WHERE s.name=products.service AND s.enabled=0)').all().map(p=>pricedProduct(db,p)));
      if (p==='/api/services' && method==='GET') return send(200,listServices(db));
      if(p==='/api/browse' && method==='GET')return send(200,budgetProducts(db,url.searchParams));
      if (p==='/api/catalog' && method==='GET') return send(200,serviceProducts(db,url.searchParams.get('service'),url.searchParams.get('page') || '1'));
      if(p==='/api/addons' && method==='GET')return send(200,{items:addons,whatsapp_number:businessWhatsApp});
      if(p==='/api/enquiries' && method==='POST'){rate(req,'enquiry',20);return send(201,createEnquiry(db,data));}
      if (p==='/api/site' && method==='GET') return send(200,storefront(db));
      if (p==='/api/bookings' && method==='POST') {rate(req,'booking',20); const result=createBooking(db,data);runReminders(db);return send(201,result);}
      if (p==='/api/opt-out' && method==='POST') {
        rate(req,'opt-out',30);const tokenHash=hash(text(data.token,'token',128,true));const c=db.prepare('SELECT id FROM customers WHERE deleted_at IS NULL AND (opt_out_token_hash=? OR id IN (SELECT customer_id FROM opt_out_links WHERE token_hash=?))').get(tokenHash,tokenHash);
        if(!c) fail('This opt-out link is invalid. Contact Party Bing for help.',404);
        transaction(db,()=>optOut(db,c.id));return send(200,{ok:true});
      }
      if (p==='/api/login' && method==='POST') {rate(req,'login',10);const result=login(db,text(data.email,'email',200,true),text(data.password,'password',512,true));return send(200,{admin:result.admin,csrf:result.csrf},{'Set-Cookie':`pb_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`});}
      const admin=session(db,req);if (!admin) fail('Please sign in to continue.',401);
      if (method!=='GET' && req.headers['x-csrf-token']!==admin.csrf) fail('Session verification failed. Refresh and try again.',403);
      const owner=()=>{if(admin.role!=='owner') fail('Owner access is required.',403);};
      if(p==='/api/me' && method==='GET') return send(200,admin);
      if(p==='/api/logout' && method==='POST') {db.prepare('DELETE FROM sessions WHERE admin_id=? AND csrf=?').run(admin.id,admin.csrf);return send(200,{ok:true},{'Set-Cookie':'pb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
      if(p==='/api/admin/enquiries' && method==='GET')return send(200,listEnquiries(db));
      const enquiryMatch=p.match(/^\/api\/admin\/enquiries\/([^/]+)$/);
      if(enquiryMatch && method==='PATCH'){updateEnquiry(db,enquiryMatch[1],data.status,admin.id);return send(200,{ok:true});}
      if(p==='/api/admin/overview' && method==='GET') return send(200,metrics(db));
      if(p==='/api/admin/reminders' && method==='GET') return send(200,listReminders(db,url.searchParams.get('filter')||'14'));
      if(p==='/api/admin/reminders/run' && method==='POST') return send(200,runReminders(db));
      if(p==='/api/admin/team' && method==='GET') return send(200,db.prepare('SELECT id,name,role FROM admins ORDER BY name').all());
      if(p==='/api/admin/customers' && method==='GET') return send(200,customers(db,url.searchParams.get('q')||''));
      let match=p.match(/^\/api\/admin\/customers\/([^/]+)$/);
      if(match && method==='GET') return send(200,customerProfile(db,match[1]));
      if(match && method==='PATCH') {
        customerProfile(db,match[1]);
        transaction(db,()=>{
          db.prepare('UPDATE customers SET preferences=?,internal_notes=?,updated_at=? WHERE id=?').run(text(data.preferences,'preferences',2000),text(data.internal_notes,'notes',5000),now(),match[1]);
          if(data.opt_out===true) optOut(db,match[1],'admin request');
          audit(db,admin.id,'customer.updated',match[1]);
        }); return send(200,{ok:true});
      }
      if(match && method==='DELETE') {owner();if(data.confirm!=='ERASE') fail('Type ERASE to confirm.');return send(200,eraseCustomer(db,match[1],admin.id));}
      if(p==='/api/admin/customers/merge' && method==='POST') {owner();return send(200,mergeCustomers(db,text(data.source_id,'source',100,true),text(data.target_id,'target',100,true),admin.id));}
      match=p.match(/^\/api\/admin\/reminders\/([^/]+)(\/whatsapp)?$/);
      if(match && method==='GET' && match[2]) return send(200,whatsappMessage(db,match[1]));
      if(match && method==='POST' && !match[2]) return send(200,reminderAction(db,match[1],data,admin.id));
      match=p.match(/^\/api\/admin\/occasions\/([^/]+)$/);
      if(match && method==='PATCH') {
        if(!db.prepare('SELECT id FROM customer_occasions WHERE id=?').get(match[1])) fail('Occasion not found.',404);
        const days=Number(data.reminder_days_before);if(!Number.isInteger(days)||days<0||days>365) fail('Reminder interval must be 0–365 days.');
        if(data.paused_until && !validDate(data.paused_until)) fail('Choose a valid pause date.');
        if(!['feb28','mar1','skip'].includes(data.leap_day_policy)) fail('Select a leap-day policy.');
        transaction(db,()=>{
          db.prepare('UPDATE customer_occasions SET reminder_days_before=?,paused_until=?,leap_day_policy=?,updated_at=? WHERE id=?').run(days,data.paused_until||null,data.leap_day_policy,now(),match[1]);
          // Preserve completed history. Recalculate outstanding tasks when policy/interval changes.
          const o=db.prepare('SELECT * FROM customer_occasions WHERE id=?').get(match[1]);
          for(const r of db.prepare("SELECT * FROM celebration_reminders WHERE customer_occasion_id=? AND status!='completed'").all(o.id)) {
            if (r.status==='disabled' && !o.reminder_enabled) continue;
            const month=o.occasion_month===2 && o.occasion_day===29;
            // Apply leap changes in the engine's date helper via local date calculation below.
            let date=r.occurrence_date;
            if(month) {const leap=r.occasion_year%4===0&&(r.occasion_year%100!==0||r.occasion_year%400===0);date=leap?`${r.occasion_year}-02-29`:data.leap_day_policy==='skip'?null:`${r.occasion_year}-${data.leap_day_policy==='mar1'?'03-01':'02-28'}`;}
            if(date) db.prepare("UPDATE celebration_reminders SET occurrence_date=?,scheduled_for=?,status=CASE WHEN status='disabled' THEN 'pending' ELSE status END,updated_at=? WHERE id=?").run(date,addDays(date,-days),now(),r.id);
            else db.prepare("UPDATE celebration_reminders SET status='disabled',updated_at=? WHERE id=?").run(now(),r.id);
          }
          audit(db,admin.id,'occasion.updated',match[1]);
        });runReminders(db);return send(200,{ok:true});
      }
      if(p==='/api/admin/bookings' && method==='GET') return send(200,db.prepare('SELECT b.*,c.full_name FROM bookings b JOIN customers c ON c.id=b.customer_id ORDER BY b.created_at DESC').all());
      match=p.match(/^\/api\/admin\/bookings\/([^/]+)$/);
      if(match && method==='PATCH') {
        if(!['requested','confirmed','completed','cancelled'].includes(data.status)) fail('Invalid status.');
        if(!Number.isInteger(data.amount)||data.amount<0||data.amount>10000000) fail('Invalid booking amount.');
        transaction(db,()=>{const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(match[1]);if(!b) fail('Booking not found.',404);
          db.prepare('UPDATE bookings SET status=?,amount=?,updated_at=? WHERE id=?').run(data.status,data.amount,now(),b.id);
          db.prepare('INSERT INTO customer_interactions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),b.customer_id,null,admin.id,'booking_updated',data.status,`${b.product_name} · ₹${data.amount}`,null,null,now());audit(db,admin.id,'booking.updated',b.id);});return send(200,{ok:true});
      }
      if(p==='/api/admin/services' && method==='GET')return send(200,listServices(db,true));
      if(p==='/api/admin/services' && method==='PATCH'){
        const service=listServices(db,true).find(s=>s.name===data.name);if(!service)fail('Service not found.',404);
        if(Object.hasOwn(data,'enabled')){
        if(typeof data.enabled!=='boolean')fail('Service status must be enabled or disabled.');
        transaction(db,()=>{db.prepare('INSERT INTO services(name,enabled) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled').run(service.name,Number(data.enabled));audit(db,admin.id,data.enabled?'service.enabled':'service.disabled',service.name);});
        return send(200,{ok:true});
      }
      const discount=percentage(data.discount_percent);
        transaction(db,()=>{db.prepare('INSERT INTO services(name,discount_percent) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET discount_percent=excluded.discount_percent').run(service.name,discount);audit(db,admin.id,'service.discount',service.name,String(discount));});
        return send(200,{ok:true});
      }
      if(p==='/api/admin/services' && method==='POST'){
        const name=text(data.name,'service name',100,true),description=text(data.description,'description',1000);
        if(!/[\p{L}\p{N}]/u.test(name))fail('Service name must contain letters or numbers.');
        if(listServices(db,true).some(s=>s.slug===serviceSlug(name)))fail('A service with this name already exists.',409);
        transaction(db,()=>{db.prepare('INSERT INTO services(name,description) VALUES (?,?)').run(name,description);audit(db,admin.id,'service.created',name);});
        return send(201,{name,slug:serviceSlug(name)});
      }
      if(p==='/api/admin/reviews' && method==='GET')return send(200,db.prepare('SELECT r.*,p.name AS product_name FROM product_reviews r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 500').all());
      const reviewMatch=p.match(/^\/api\/admin\/reviews\/([^/]+)$/);
      if(reviewMatch && method==='PATCH'){
        if(!['approved','hidden'].includes(data.status))fail('Choose approved or hidden.');
        if(!db.prepare('SELECT id FROM product_reviews WHERE id=?').get(reviewMatch[1]))fail('Review not found.',404);
        transaction(db,()=>{db.prepare('UPDATE product_reviews SET status=? WHERE id=?').run(data.status,reviewMatch[1]);audit(db,admin.id,'review.'+data.status,reviewMatch[1]);});return send(200,{ok:true});
      }
      const checkService=name=>{if(!listServices(db,true).some(s=>s.name===name))fail('Choose an available service. Add new services in Services first.');};
      if(p==='/api/admin/products' && method==='GET') return send(200,db.prepare('SELECT p.*,EXISTS(SELECT 1 FROM featured_products f WHERE f.product_id=p.id) AS featured FROM products p').all().map(p=>pricedProduct(db,p)));
      if(p==='/api/admin/products' && method==='POST') {
        const values=productInput(data), productId=data.product_id ? text(data.product_id,'product ID',64,true) : id();
        if(!/^[a-zA-Z0-9_-]{3,64}$/.test(productId))fail('Product ID must be 3–64 letters, numbers, hyphens or underscores.');
        if(db.prepare('SELECT id FROM products WHERE id=?').get(productId))fail('This product ID is already in use.',409);
        checkService(values.service);const images=validateImages(db,productId,data.images);
        transaction(db,()=>{
          db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,0)').run(productId,values.name,values.description,values.service,values.price,values.theme);
          saveDetails(db,productId,values);saveImages(db,productId,images);audit(db,admin.id,'product.created',productId);
        });return send(201,{ok:true,id:productId});
      }
      match=p.match(/^\/api\/admin\/products\/([^/]+)$/);
      if(match && method==='PATCH') {
        const product=db.prepare('SELECT * FROM products WHERE id=?').get(match[1]);
        if(!product) fail('Decoration not found.',404);
        transaction(db,()=>{
          if(typeof data.featured==='boolean') {
            if(data.featured) {
              if(product.archived) fail('Restore this decoration before featuring it.');
              const exists=db.prepare('SELECT product_id FROM featured_products WHERE product_id=?').get(product.id);
              if(!exists && db.prepare('SELECT COUNT(*) AS n FROM featured_products').get().n>=6) fail('The homepage can feature up to 6 packages. Unfeature a package first.');
              db.prepare('INSERT OR IGNORE INTO featured_products(product_id) VALUES (?)').run(product.id);
            } else db.prepare('DELETE FROM featured_products WHERE product_id=?').run(product.id);
            audit(db,admin.id,'product.featured',product.id,String(data.featured));
          } else if(typeof data.archived==='boolean') {
            db.prepare('UPDATE products SET archived=? WHERE id=?').run(data.archived?1:0,product.id);
            if(data.archived) db.prepare('DELETE FROM featured_products WHERE product_id=?').run(product.id);
            audit(db,admin.id,'product.archive',product.id);
          } else {
            const values=productInput(data);checkService(values.service);const images=validateImages(db,product.id,data.images);
            db.prepare('UPDATE products SET name=?,description=?,service=?,price=?,theme=? WHERE id=?').run(values.name,values.description,values.service,values.price,values.theme,product.id);
            saveDetails(db,product.id,values);saveImages(db,product.id,images);audit(db,admin.id,'product.updated',product.id);
          }
        });return send(200,{ok:true});
      }
      if(p==='/api/admin/storefront' && method==='GET') return send(200,storefront(db));
      if(p==='/api/admin/storefront' && method==='PATCH') {
        const discount=percentage(data.discount_percent);
        if(!seasons.includes(data.season)) fail('Choose one of the preloaded seasonal themes.');
        transaction(db,()=>{
          db.prepare("UPDATE settings SET value=? WHERE key='store_discount'").run(String(discount));
          db.prepare("UPDATE settings SET value=? WHERE key='store_season'").run(data.season);
          audit(db,admin.id,'storefront.updated','storefront',JSON.stringify({discount_percent:discount,season:data.season}));
        });return send(200,storefront(db));
      }
      if(p==='/api/admin/settings' && method==='GET') return send(200,getSettings(db));
      if(p==='/api/admin/settings' && method==='PATCH') {
        owner();text(data.timezone,'timezone',100,true);try {todayInZone(data.timezone);} catch {fail('Choose a valid IANA timezone.');}
        if(!['feb28','mar1','skip'].includes(data.leap_day_policy)) fail('Invalid leap-day policy.');
        if(!Number.isInteger(Number(data.retention_days))||Number(data.retention_days)<30) fail('Retention must be at least 30 days.');
        for(const key of ['timezone','leap_day_policy','retention_days']) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(data[key]),key);
        audit(db,admin.id,'settings.updated','settings');return send(200,{ok:true});
      }
      if(p==='/api/admin/retention' && method==='GET') {
        owner();const cutoff=addDays(todayInZone(getSettings(db).timezone),-Number(getSettings(db).retention_days));
        return send(200,customers(db).filter(c=>(c.last_booking_date || c.created_at.slice(0,10))<cutoff));
      }
      fail('Not found.',404);
    } catch(e) {if(!e.status) console.error(e);send(e.status||500,{error:e.status?e.message:'Something went wrong. Please try again.'});}
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const db=openDb();runReminders(db);
  const server=makeServer(db);server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`Party Bing running at http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`));
  // Startup catch-up plus hourly checks are independent of browsers or admin sessions.
  const timer=setInterval(()=>{try{runReminders(db);}catch(e){console.error('Reminder job failed',e);}},3600000);timer.unref();
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{clearInterval(timer);server.close(()=>{db.close();process.exit(0);});});
}
