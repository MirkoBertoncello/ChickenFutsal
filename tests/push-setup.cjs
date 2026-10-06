const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto,createPublicKey,createPrivateKey}=require('node:crypto');
(async()=>{
 const nodes={};const context={crypto:webcrypto,Uint8Array,URL,btoa:s=>Buffer.from(s,'binary').toString('base64'),document:{querySelector:s=>nodes[s]??={}},window:{CLUB_CONFIG:{supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'public-key'}},fetch:async p=>({ok:true,text:async()=>fs.readFileSync('web'+p,'utf8')})};
 vm.createContext(context);const html=fs.readFileSync('web/push-setup.html','utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 await vm.runInContext('generateSetup()',context);const setup=vm.runInContext('setup',context);assert.ok(setup);
 const env=Object.fromEntries(setup.env.trim().split('\n').map(l=>l.split('=')));
 const raw=Buffer.from(env.VAPID_PUBLIC_KEY,'base64url');assert.equal(raw.length,65);assert.equal(raw[0],4);
 const privateKey=createPrivateKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url'),d:env.VAPID_PRIVATE_KEY}});
 assert.equal(createPublicKey(privateKey).export({format:'jwk'}).x,raw.subarray(1,33).toString('base64url'));
 assert.ok(!setup.sql.includes('__PUBLIC_KEY__'));assert.ok(setup.sql.includes(env.VAPID_PUBLIC_KEY));assert.ok(setup.sql.includes(env.CRON_SECRET));assert.ok(!setup.sql.includes(env.VAPID_PRIVATE_KEY));
 assert.equal(setup.functionSource,fs.readFileSync('supabase/functions/send-push/index.ts','utf8'));
 await vm.runInContext('generateSetup()',context);assert.equal(vm.runInContext('setup.env',context),setup.env);
 assert.ok(!fs.readFileSync('web/config.js','utf8').includes(env.VAPID_PRIVATE_KEY));
 console.log('PASS push setup: valid P-256 keys, private secrets generated locally, consistent worker source, SQL substitutions, no accidental regeneration');
})().catch(e=>{console.error(e);process.exit(1)});
