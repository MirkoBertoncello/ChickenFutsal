#!/usr/bin/env python3
"""Run every five minutes on QNAP; read secrets from a protected environment."""
import json,os,urllib.request
base=os.environ['SUPABASE_URL'].rstrip('/')
req=urllib.request.Request(base+'/functions/v1/send-push',data=b'{}',headers={'apikey':os.environ['SUPABASE_PUBLISHABLE_KEY'],'Authorization':'Bearer '+os.environ['CRON_SECRET'],'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=120) as response:
 data=json.load(response)
 if not data.get('ok'):raise SystemExit('Push delivery unavailable')
print('ChickenFutsal: notification queue processed')
