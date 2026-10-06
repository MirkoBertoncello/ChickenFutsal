// Run locally: node operations/generate-vapid.cjs
// Private material is written to an ignored, owner-only directory, never printed.
const {generateKeyPairSync,randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'local-secrets');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const target=path.join(dir,'vapid.env');if(fs.existsSync(target))throw Error('Keys already exist; refusing to overwrite');
const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk=privateKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
fs.writeFileSync(target,`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${jwk.d}\nCRON_SECRET=${randomBytes(32).toString('hex')}\nVAPID_SUBJECT=mailto:SOSTITUISCI-CON-LA-TUA-EMAIL\n`,{mode:0o600});
console.log('Keys saved to operations/local-secrets/vapid.env. Keep the file private.');
