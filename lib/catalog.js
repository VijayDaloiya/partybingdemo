import { pricedProduct, storefront } from './storefront.js';
import { fail } from './crm.js';

export const serviceSlug = name => name.trim().toLowerCase().replace(/\s+/g, '-');

export function listServices(db, includeDisabled = false) {
  return db.prepare(`WITH names AS (SELECT name FROM services UNION SELECT service FROM products WHERE archived=0)
    SELECT n.name,COALESCE(s.enabled,1) AS enabled,COALESCE(s.description,'') AS description,COALESCE(s.discount_percent,0) AS discount_percent,COUNT(p.id) AS package_count,
    MIN(CASE WHEN COALESCE(s.discount_percent,0)>0 THEN ROUND(p.price*(100-s.discount_percent)/100.0) WHEN ?>0 THEN ROUND(p.price*(100-?)/100.0) ELSE COALESCE(d.sale_price,p.price) END) AS starting_price
    FROM names n LEFT JOIN services s ON s.name=n.name LEFT JOIN products p ON p.service=n.name AND p.archived=0
    LEFT JOIN product_details d ON d.product_id=p.id GROUP BY n.name ORDER BY n.name`).all(storefront(db).discount_percent,storefront(db).discount_percent)
    .filter(s=>includeDisabled||s.enabled).map(s=>({...s,slug:serviceSlug(s.name)}));
}

export function featuredProducts(db) {
  return db.prepare('SELECT p.* FROM featured_products f JOIN products p ON p.id=f.product_id WHERE p.archived=0 AND NOT EXISTS(SELECT 1 FROM services s WHERE s.name=p.service AND s.enabled=0) ORDER BY f.position,p.name,p.id LIMIT 6').all().map(p => pricedProduct(db,p));
}

export function serviceProducts(db, slug, requestedPage = '1') {
  const service = listServices(db).find(s => s.slug === slug);
  if (!service) fail('Service not found.', 404);
  const pageSize = 12;
  const pageCount = Math.max(1,Math.ceil(service.package_count / pageSize));
  const parsed = Number(requestedPage);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail('Choose a valid page number.');
  const page = Math.min(parsed, pageCount);
  const items = db.prepare('SELECT * FROM products WHERE archived=0 AND service=? ORDER BY name COLLATE NOCASE,id LIMIT ? OFFSET ?')
    .all(service.name, pageSize, (page - 1) * pageSize);
  return { service, items: items.map(p => pricedProduct(db,p)), page, page_size: pageSize, page_count: pageCount, total: service.package_count };
}

export function budgetProducts(db,params){
 const raw=params.get('under'),limit=raw===null||raw===''?null:Number(raw);
 if(limit!==null && (!Number.isSafeInteger(limit)||limit<1||limit>10000000))fail('Choose a valid budget.');
 const slug=params.get('service')||'',service=slug?listServices(db).find(s=>s.slug===slug):null;
 if(slug&&!service)fail('Service not found.',404);
 const requested=Number(params.get('page')||'1');if(!Number.isSafeInteger(requested)||requested<1)fail('Choose a valid page number.');
 const store=storefront(db).discount_percent;
 const query=`WITH priced AS (SELECT p.*,CASE WHEN COALESCE(s.discount_percent,0)>0 THEN ROUND(p.price*(100-s.discount_percent)/100.0) WHEN ?>0 THEN ROUND(p.price*(100-?)/100.0) ELSE COALESCE(d.sale_price,p.price) END AS current_price
 FROM products p LEFT JOIN services s ON s.name=p.service LEFT JOIN product_details d ON d.product_id=p.id WHERE p.archived=0 AND COALESCE(s.enabled,1)=1)
 SELECT * FROM priced WHERE (? IS NULL OR current_price<?) AND (?='' OR service=?)`;
 const args=[store,store,limit,limit,service?.name||'',service?.name||''];
 const total=db.prepare('SELECT COUNT(*) AS n FROM ('+query+')').get(...args).n;
 const page_size=12,page_count=Math.max(1,Math.ceil(total/page_size)),page=Math.min(requested,page_count);
 const items=db.prepare(query+' ORDER BY current_price,name COLLATE NOCASE,id LIMIT ? OFFSET ?').all(...args,page_size,(page-1)*page_size).map(p=>pricedProduct(db,p));
 return {items,total,page,page_size,page_count,under:limit,service};
}
