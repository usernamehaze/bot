// Makes the two keys Cassie's reminders need, and prints them (nothing is saved anywhere).
//   node scripts/make-vapid-keys.mjs
// Then in Cloudflare (Worker → Settings → Variables and Secrets): VAPID_PUBLIC_KEY as Text, VAPID_PRIVATE_KEY as Secret.
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log('VAPID_PUBLIC_KEY  (Text):   ' + b64u(pub));
console.log('VAPID_PRIVATE_KEY (Secret): ' + d);
console.log('\nKeep the private key out of chats, files and screenshots. If it ever leaks, make a new pair (students turn reminders on again).');
