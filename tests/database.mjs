import { PGlite } from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated;create role service_role; create role supabase_auth_admin;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.test_uid',true),'')::uuid$$;`);
await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20261006_invite_only_signup.sql',import.meta.url),'utf8'));
for(let i=1;i<=12;i++){
 await db.query(`insert into club_private.players(id,name,role) values($1,$2,'Regista')`,[i,'Player '+i]);
 await db.query(`insert into club_private.members(player_id,email,is_admin,see_all) values($1,$2,$3,false)`,[i,`p${i}@test.invalid`,i===1]);
 await db.query(`insert into auth.users values($1,$2,now())`,[`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`,`p${i}@test.invalid`]);
}
await db.exec(`select setval(pg_get_serial_sequence('club_private.players','id'),12,true)`);
async function as(i,role='authenticated'){
 await db.exec('reset role');await db.query(`select set_config('request.test_uid',$1,false)`,[`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`]);await db.exec(`set role ${role}`);
}
const act=async (action,data)=> (await db.query('select public.club_action($1,$2::jsonb) result',[action,JSON.stringify(data)])).rows[0].result;
const snapshot=async (season=2026)=>(await db.query('select public.club_snapshot($1) result',[season])).rows[0].result;
async function rejects(fn){await assert.rejects(fn)}
await as(1,'supabase_auth_admin');
const hook=async email=>(await db.query('select public.club_before_user_created($1::jsonb) result',[JSON.stringify({user:{email}})])).rows[0].result;
assert.deepEqual(await hook('p1@test.invalid'),{});
assert.deepEqual(await hook(' P2@TEST.INVALID '),{});
assert.equal((await hook('outside@test.invalid')).error.http_code,403);
assert.equal((await hook('')).error.http_code,403);
assert.equal((await hook(null)).error.http_code,403);
await rejects(()=>db.query('select * from club_private.members'));
await as(2);
await rejects(()=>hook('p1@test.invalid'));
let s=await snapshot();assert.equal(s.players.filter(p=>p.ratings).length,1);assert.ok(s.players.find(p=>p.id===2).ratings);assert.equal(s.players.find(p=>p.id===1).goals,undefined);
await rejects(()=>db.query('select * from club_private.ballots'));await rejects(()=>act('ratings',{id:2,ratings:[90,90,90,90,90,90]}));
await rejects(()=>db.query('select public.club_claim_push(20)'));
await as(1);
await act('permission',{id:2,key:'seeAll',value:true});
await act('ratings',{id:2,ratings:[99,80,70,60,50,40]});
await rejects(()=>act('ratings',{id:2,ratings:[99,80,70,null,50,40]}));
await rejects(()=>act('match',{season:2026,date:'2026-10-08',time:'21:00',field:'Jumbo',a:[1,2,3,4,5],b:[1,7,8,9,10]}));
let m=await act('match',{season:2026,date:'2026-10-08',time:'21:00',field:'Jumbo',a:[1,2,3,4,5],b:[6,7,8,9,10]});
s=await snapshot();assert.equal(s.matches.length,1);assert.equal(s.notifications.length,1);
const result={};for(let i=1;i<=10;i++)result[i]={goals:i===1?2:0,own:i===6?1:0,present:true};
await act('result',{id:m.id,result});await act('result',{id:m.id,result});
s=await snapshot();assert.equal(s.players.find(p=>p.id===1).goals,2);assert.equal(s.players.find(p=>p.id===1).apps,1);assert.deepEqual(s.matches[0].score,[3,0]);
result[1].goals=1;await act('result',{id:m.id,result});s=await snapshot();assert.equal(s.players.find(p=>p.id===1).goals,1);assert.equal(s.players.find(p=>p.id===1).apps,1);
result[1].present=false;await rejects(()=>act('result',{id:m.id,result}));assert.equal((await snapshot()).players.find(p=>p.id===1).goals,1);
await act('round_open',{season:2026,award:'pollone'});let r=(await snapshot()).rounds[0];assert.equal(r.candidates.length,12);
await act('vote',{round:r.id,candidate:1});await rejects(()=>act('vote',{round:r.id,candidate:2}));
s=await snapshot();assert.equal(s.rounds[0].count,1);assert.deepEqual(s.rounds[0].results,[]);assert.equal(s.rounds[0].voted,true);
await as(2);assert.equal((await snapshot()).players.filter(p=>p.ratings).length,12);await act('vote',{round:r.id,candidate:1});
await as(1);await rejects(()=>act('round_open',{season:2026,award:'pollone',candidates:[1,2]}));await act('round_close',{id:r.id});
s=await snapshot();assert.deepEqual(s.rounds[0].results,[{id:1,count:2}]);
await act('round_open',{season:2026,award:'pollone',candidates:[1,2]});let second=(await snapshot()).rounds[1];assert.equal(second.count,0);assert.equal(second.voted,false);
await as(12);await act('vote',{round:second.id,candidate:1});await rejects(()=>act('vote',{round:second.id,candidate:12}));
await as(1);await act('round_close',{id:second.id});await rejects(()=>act('round_open',{season:2026,award:'pollone',candidates:[1,3]}));
for(let turn=3;turn<=4;turn++){await act('round_open',{season:2026,award:'pollone',candidates:[1]});let x=(await snapshot()).rounds.at(-1);await act('vote',{round:x.id,candidate:1});await act('round_close',{id:x.id});}
await rejects(()=>act('round_open',{season:2026,award:'pollone',candidates:[1]}));let last=(await snapshot()).rounds.at(-1);await act('round_final',{id:last.id});assert.equal((await snapshot()).rounds.at(-1).status,'final');
await act('round_open',{season:2026,award:'bidone'});assert.equal((await snapshot()).rounds.find(x=>x.award==='bidone').turn,1);
await act('round_open',{season:2027,award:'pollone'});assert.equal((await snapshot(2027)).rounds[0].turn,1);assert.equal((await snapshot(2027)).players.find(p=>p.id===1).goals,0);
await rejects(()=>act('permission',{id:1,key:'admin',value:false}));await rejects(()=>act('invite',{id:1,email:'wrong@test.invalid'}));
await as(1,'service_role');let jobs=(await db.query('select public.club_claim_push(20) x')).rows[0].x;assert.equal(jobs.length,10);await db.query('select public.club_ack_push($1,$2,true)',[jobs[0].id,jobs[0].claim]);
await db.exec('reset role');await db.query(`select set_config('request.test_uid','00000000-0000-0000-0000-000000000099',false)`);await db.exec('set role authenticated');await rejects(()=>snapshot());
await db.exec('reset role;set role anon');await rejects(()=>hook('p1@test.invalid'));let health=(await db.query('select public.club_health() x')).rows[0].x;assert.equal(health.ok,true);await rejects(()=>snapshot());
await db.close();console.log('PASS database: private tables, membership, permissions, own statistics, duplicate votes, self votes, 4 rounds, independent awards, seasons, result corrections, notifications, service-only push queue');
