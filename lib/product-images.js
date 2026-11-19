import { randomUUID } from 'node:crypto';
const invalid = message => { throw Object.assign(new Error(message),{status:400}); };
export function validateImages(db,productId,images) {
  if(images===undefined)return null;
  if(!Array.isArray(images)||images.length>6)invalid('Choose up to 6 product images.');
  const seen=new Set();
  return images.map((image,index)=>{
    if(!image||typeof image!=='object')invalid('Invalid image.');
    if(image.id){
      if(seen.has(image.id)||!db.prepare('SELECT id FROM product_images WHERE id=? AND product_id=?').get(image.id,productId))invalid('Image does not belong to this product.');
      seen.add(image.id);return {id:image.id,position:index};
    }
    const match=typeof image.data_url==='string' && image.data_url.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match)invalid('Upload a JPG, PNG, or WebP image.');
    const buffer=Buffer.from(match[2],'base64');
    if(buffer.length>2*1024*1024||buffer.length<12)invalid('Each image must be a valid image up to 2 MB.');
    const valid=match[1]==='png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
    if(!valid)invalid('Image content does not match its file type.');
    const alt=typeof image.alt==='string'?image.alt.trim().slice(0,200):'';
    return {id:randomUUID(),mime:'image/'+match[1],content:buffer,alt,position:index};
  });
}
export function saveImages(db,productId,images){
  if(images===null)return;
  const keep=new Set(images.map(i=>i.id));
  for(const old of db.prepare('SELECT id FROM product_images WHERE product_id=?').all(productId))if(!keep.has(old.id))db.prepare('DELETE FROM product_images WHERE id=?').run(old.id);
  for(const image of images){
    if(image.content)db.prepare('INSERT INTO product_images VALUES (?,?,?,?,?,?)').run(image.id,productId,image.mime,image.content,image.alt,image.position);
    else db.prepare('UPDATE product_images SET position=? WHERE id=? AND product_id=?').run(image.position,image.id,productId);
  }
}
