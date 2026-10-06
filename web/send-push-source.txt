import webpush from 'npm:web-push@3.6.7';

// Secrets configured on Supabase, never in the frontend or repository.
const required = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing server configuration: ${key}`);
  return value;
};
const allowedEndpoint = (endpoint: string) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'web.push.apple.com' ||
       u.hostname === 'updates.push.services.mozilla.com' || u.hostname.endsWith('.push.services.mozilla.com') ||
       u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
};
Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', {status:405});
  const secret = required('CRON_SECRET');
  if (req.headers.get('Authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', {status:401});
  const base = required('SUPABASE_URL'), key = required('SUPABASE_SERVICE_ROLE_KEY');
  const rpc = async (name: string, body: object) => {
    const r = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Server RPC failed: ${r.status}`);
    return r.status===204?null:await r.json();
  };
  try {
    webpush.setVapidDetails(required('VAPID_SUBJECT'),required('VAPID_PUBLIC_KEY'),required('VAPID_PRIVATE_KEY'));
    const jobs = await rpc('club_claim_push',{p_limit:20});
    let processed=0;
    await Promise.all(jobs.map(async (job: any) => {
      let success=true; // In-app notification remains even when no devices subscribed.
      const expired:string[]=[];
      await Promise.all(job.subscriptions.map(async (sub: any) => {
        if (!allowedEndpoint(sub.endpoint)) {expired.push(sub.endpoint);return;}
        try {
          await webpush.sendNotification(sub,JSON.stringify({title:'ChickenFutsal',body:job.body,tag:'convocation-'+job.id}),{TTL:86400,timeout:10000});
        } catch (error) {
          const e=error as {statusCode?: number};
          if (e.statusCode===404 || e.statusCode===410) expired.push(sub.endpoint);
          else success=false;
        }
      }));
      await rpc('club_ack_push',{p_id:job.id,p_claim:job.claim,p_success:success,p_expired:expired});
      processed++;
    }));
    return Response.json({ok:true,processed});
  } catch {
    // Do not expose subscriptions, service keys or user data in logs/responses.
    return Response.json({ok:false,message:'Push delivery unavailable'},{status:503});
  }
});
