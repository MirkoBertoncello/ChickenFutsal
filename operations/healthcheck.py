#!/usr/bin/env python3
"""Daily read-only availability check. No guarantees against free-tier pausing."""
import json,os,urllib.request
base=os.environ['SUPABASE_URL'].rstrip('/')
key=os.environ['SUPABASE_PUBLISHABLE_KEY']
req=urllib.request.Request(base+'/rest/v1/rpc/club_health',data=b'{}',headers={'apikey':key,'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=30) as response:
 data=json.load(response)
 if not data.get('ok'):raise SystemExit('Database unavailable')
print('ChickenFutsal: database reachable')
