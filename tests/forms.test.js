import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const handlerSource=source.slice(source.indexOf("document.addEventListener('submit'"),source.indexOf("window.addEventListener('popstate'"));
function harness(formId,data,reject=false){
 const calls=[],button={disabled:false},error={textContent:'',setAttribute(){},focus(){this.focused=true;}};
 // Named HTML form controls mask the native .id property in the browser.
 const form={id:{name:'id',value:data.id},getAttribute:name=>name==='id'?formId:null,querySelector:s=>s==='.form-error'?error:button};
 let handler;let closed=false;const messages=[];
 vm.runInNewContext(handlerSource,{document:{addEventListener:(event,fn)=>handler=fn},formData:()=>data,editorImages:[],api:async(...args)=>{calls.push(args);if(reject)throw Error('Save rejected');return {};},close:()=>closed=true,render:async()=>{},toast:message=>messages.push(message)});
 return {run:()=>handler({target:form,preventDefault(){}}),calls,button,error,messages,get closed(){return closed;}};
}
test('product edits and creation send writes even when hidden id masks the form ID',async()=>{
 for(const id of ['existing-product','']){
  const h=harness('product-form',{id,name:'Edited product',price:'5000',sale_price:'4000',admin_rating:'4.5',trending:'on'});await h.run();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'/admin/products'+(id?'/'+id:''));assert.equal(h.calls[0][1],id?'PATCH':'POST');
  assert.equal(h.calls[0][2].name,'Edited product');assert.equal(h.calls[0][2].sale_price,4000);assert.equal(h.calls[0][2].admin_rating,4.5);assert.equal(h.calls[0][2].trending,true);
  assert.equal(h.closed,true);assert.equal(h.button.disabled,false);assert.deepEqual(h.messages,['Saved successfully.']);
 }
});
test('other record edit forms also dispatch despite named id controls',async()=>{
 for(const [formId,path] of [['profile-form','/admin/customers/record'],['occasion-form','/admin/occasions/record'],['booking-update-form','/admin/bookings/record']]){
  const h=harness(formId,{id:'record',amount:'123',reminder_days_before:'14'});await h.run();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],path);assert.equal(h.calls[0][1],'PATCH');
 }
});
test('a rejected product edit keeps the form open and never reports success',async()=>{
 const h=harness('product-form',{id:'record',price:'1',sale_price:'',admin_rating:''},true);await h.run();assert.equal(h.closed,false);assert.equal(h.error.textContent,'Save rejected');assert.equal(h.error.focused,true);assert.equal(h.button.disabled,false);assert.deepEqual(h.messages,[]);
});
