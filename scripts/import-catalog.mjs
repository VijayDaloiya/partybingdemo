import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,extname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {backup} from 'node:sqlite';
import {openDb,transaction} from '../lib/db.js';

try{process.loadEnvFile();}catch(e){if(e.code!=='ENOENT')throw e;}
const root=resolve('data/catalog-import-20261024/images/Categories');
const mappings={'Anniversary Decor':'Anniversary Decoration','Baby Shower Decor':'Baby Shower Decoration','Birthday Decor':'Birthday Decoration'};
const groups=new Map();
for(const folder of readdirSync(root).sort()){
 for(const file of readdirSync(resolve(root,folder)).sort()){
  const stem=basename(file,extname(file)), id=stem.replace(/_img\d+$/i,'');
  if(!/^[A-Za-z0-9_-]{3,64}$/.test(id))throw Error('Invalid product ID: '+id);
  const service=mappings[folder]||folder.replace(/ Decor$/,' Decoration');
  if(groups.has(id)&&groups.get(id).service!==service)throw Error('ID occurs in multiple categories: '+id);
  const group=groups.get(id)||{id,service,images:[]};
  const content=readFileSync(resolve(root,folder,file));
  const mime=content[0]===255&&content[1]===216&&content[2]===255?'image/jpeg':content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':content.toString('ascii',0,4)==='RIFF'&&content.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!mime)throw Error('Unsupported image: '+file);
  group.images.push({file,content,mime,position:Number(stem.match(/_img(\d+)$/i)?.[1]||0),hash:createHash('sha256').update(content).digest('hex')});
  groups.set(id,group);
 }
}
for(const g of groups.values()){
 if(g.images.length>6)throw Error('More than six photos: '+g.id);
 g.images.sort((a,b)=>a.position-b.position||a.file.localeCompare(b.file));
}
const db=openDb();
try{
 const report={products:groups.size,images:[...groups.values()].reduce((n,g)=>n+g.images.length,0),categories:{},created:0,skipped:0};
 for(const g of groups.values())report.categories[g.service]=(report.categories[g.service]||0)+1;
 if(!process.argv.includes('--apply')){console.log(JSON.stringify(report,null,2));process.exitCode=0;}
 else{
  // Back up the live SQLite database consistently, including its WAL.
  await backup(db,resolve('data/catalog-before-import-'+Date.now()+'.sqlite'));
  transaction(db,()=>{
   for(const g of groups.values()){
    const old=db.prepare('SELECT id FROM products WHERE id=?').get(g.id);
    if(old){
     const images=db.prepare('SELECT content FROM product_images WHERE product_id=? ORDER BY position').all(g.id);
     if(images.length!==g.images.length||images.some((i,n)=>createHash('sha256').update(i.content).digest('hex')!==g.images[n].hash))throw Error('Existing product conflicts with import: '+g.id);
     report.skipped++;continue;
    }
    db.prepare('INSERT OR IGNORE INTO services(name) VALUES (?)').run(g.service);
    const name=g.service+' '+g.id.split('_').at(-1);
    const description=g.service+' design '+g.id+'. Contact us to confirm the setup and included items.';
    db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,0)').run(g.id,name,description,g.service,5000,'blush');
    db.prepare("INSERT INTO product_details(product_id,inclusions,setup_type) VALUES (?,?,'unspecified')").run(g.id,'Please confirm included items with our team when ordering.');
    g.images.forEach((image,index)=>db.prepare('INSERT INTO product_images VALUES (?,?,?,?,?,?)').run(randomUUID(),g.id,image.mime,image.content,name+' — photo '+(index+1),index));
    report.created++;
   }
   db.prepare('INSERT INTO audit_log VALUES (?,NULL,?,?,?,?)').run(randomUUID(),'catalog.import','images-20261024T072321Z-1-001.zip',JSON.stringify(report),new Date().toISOString());
  });
  writeFileSync(resolve('data/catalog-import-20261024/report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }
}finally{db.close();}
