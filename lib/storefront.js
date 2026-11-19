export function serviceEnabled(db,name){return db.prepare('SELECT enabled FROM services WHERE name=?').get(name)?.enabled!==0;}

export const seasons = ['default', 'new-year', 'wedding-season', 'janmashtami', 'diwali'];
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function percentage(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) invalid('Discount must be a whole percentage from 0 to 100.');
  return value;
}

export function storefront(db) {
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(s => [s.key,s.value]));
  return { discount_percent: Number(settings.store_discount || 0), season: settings.store_season || 'default' };
}

export function pricedProduct(db, product) {
  const details = db.prepare('SELECT inclusions,setup_type,discount_percent,sale_price,trending,admin_rating FROM product_details WHERE product_id=?').get(product.id);
  const p = { ...product, inclusions: product.description, setup_type: 'unspecified', discount_percent: null, sale_price: null, trending: 0, admin_rating: null, ...details };
  const category = db.prepare('SELECT discount_percent FROM services WHERE name=?').get(p.service)?.discount_percent || 0;
  const store = storefront(db).discount_percent;
  const override = category || store;
  const pricing_source = category ? 'Service offer' : store ? 'Store-wide offer' : p.sale_price!==null ? 'Product discount price' : 'Original price';
  const final_price = override ? Math.round(p.price*(100-override)/100) : p.sale_price ?? p.price;
  const images=db.prepare('SELECT id,alt FROM product_images WHERE product_id=? ORDER BY position,id').all(p.id).map(i=>({...i,url:'/api/images/'+i.id}));
  const ratings=db.prepare("SELECT COUNT(*) AS review_count,ROUND(AVG(rating),1) AS rating FROM product_reviews WHERE product_id=? AND status='approved'").get(p.id);
  return { ...p, effective_discount: p.price ? Math.round((p.price-final_price)/p.price*10000)/100 : 0, pricing_source, final_price, images, ...ratings };
}

export function productInput(data) {
  const required = (key, max) => {
    if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > max) invalid(`Enter a valid ${key.replaceAll('_',' ')} (up to ${max} characters).`);
    return data[key].trim();
  };
  if (!Number.isSafeInteger(data.price) || data.price < 0 || data.price > 10000000) invalid('Price must be a whole rupee amount from 0 to 10,000,000.');
  if (!['wall','stand','both'].includes(data.setup_type)) invalid('Choose wall, stand, or wall and stand setup.');
  if (!['blush','gold','lavender'].includes(data.theme)) invalid('Choose a valid product visual theme.');
  if (data.sale_price != null && (!Number.isSafeInteger(data.sale_price) || data.sale_price<0 || data.sale_price>data.price)) invalid('Discount price must be a whole rupee amount between 0 and the original price.');
  if (data.discount_percent != null) invalid('Use a product discount price. Percentage offers belong in Services or Offers & themes.');
  if (data.admin_rating != null && (typeof data.admin_rating!=='number' || !Number.isFinite(data.admin_rating) || data.admin_rating<1 || data.admin_rating>5 || Math.abs(data.admin_rating*10-Math.round(data.admin_rating*10))>0.00001)) invalid('Admin rating must be between 1 and 5, with at most one decimal place.');
  if(data.trending!==undefined && typeof data.trending!=='boolean')invalid('Trending must be on or off.');
  return { trending: data.trending?1:0, admin_rating: data.admin_rating??null, sale_price: data.sale_price ?? null, name: required('name',150), description: required('description',1000), service: required('service',100), price: data.price, theme: data.theme, inclusions: required('inclusions',3000), setup_type: data.setup_type, discount_percent: null };
}

export function saveDetails(db, productId, p) {
  db.prepare(`INSERT INTO product_details(product_id,inclusions,setup_type,discount_percent,sale_price,trending,admin_rating) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(product_id) DO UPDATE SET inclusions=excluded.inclusions,setup_type=excluded.setup_type,discount_percent=excluded.discount_percent,sale_price=excluded.sale_price,trending=excluded.trending,admin_rating=excluded.admin_rating`)
    .run(productId,p.inclusions,p.setup_type,null,p.sale_price??null,p.trending?1:0,p.admin_rating??null);
}
