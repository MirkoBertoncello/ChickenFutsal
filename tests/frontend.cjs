const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
function harness(online=false){
 let identityRemoved=false;const nodes={};const n=id=>nodes[id]??={value:'',checked:false,innerHTML:'',disabled:false,insertAdjacentHTML(where,s){this.innerHTML=s+this.innerHTML},addEventListener(){},close(){},showModal(){},textContent:'',checkValidity(){return true}};
 const identity=n('.identity');let identityHTML='';Object.defineProperty(identity,'innerHTML',{get(){return identityHTML},set(value){identityHTML=value;identityRemoved=!value.includes('id="identity"')}});
 const mem={};let calls=[];
 const c={console,structuredClone,localStorage:{getItem(k){return mem[k]||null},setItem(k,v){mem[k]=v}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},document:{querySelector:id=>id==='#identity'&&identityRemoved?null:n(id),querySelectorAll(){return[]}},window:{CLUB_CONFIG:online?{supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'public-test-key'}:{},scrollTo(){}},navigator:{},location:{protocol:'https:',origin:'https://club.pages.dev',pathname:'/',hash:'',search:''},history:{replaceState(){}},setTimeout(){},clearTimeout(){},Date,Blob,URL,URLSearchParams,Uint8Array,atob,fetch:async(url,args)=>{calls.push({url,args});return {ok:true,json:async()=>({})}}};
 vm.createContext(c);const html=fs.readFileSync(new URL('../web/index.html',`file://${__filename}`),'utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0],c);vm.runInContext(fs.readFileSync(new URL('../web/cloud.js',`file://${__filename}`),'utf8'),c);return {c,n,calls};
}
(async()=>{
 let {c}=harness();await vm.runInContext(`(async()=>{
  for(const id of Object.keys(pages)){page=id;render();if(!$('#app').innerHTML)throw Error('empty '+id)}
  user=11;page='players';render();if(($('#app').innerHTML.match(/class="radar"/g)||[]).length!==1)throw Error('own radar');profile(0);if(!$('#modal').innerHTML.includes('riservate'))throw Error('privacy');
  user=11;page='votes';render();if($('#app').innerHTML.includes('Attiva votazione'))throw Error('nonadmin voting control');await openFirstRound('pollone');if(currentRounds('pollone').length)throw Error('nonadmin opened vote');if(await action('round_open',{award:'bidone',season}))throw Error('nonadmin direct open');
  user=0;page='votes';render();await openFirstRound('pollone');let first=currentRounds('pollone')[0];await action('vote',{round:first.id,candidate:0});if(!hasVoted(first))throw Error('self vote');let count=first.count;await action('vote',{round:first.id,candidate:1});if(first.count!==count)throw Error('duplicate');await action('round_close',{id:first.id});await action('round_open',{season,award:'pollone',candidates:[0,1]});let second=currentRounds('pollone')[1];if(second.count||hasVoted(second))throw Error('reset');user=11;await action('vote',{round:second.id,candidate:0});if(!hasVoted(second))throw Error('eliminated voter');user=0;await action('round_close',{id:second.id});await action('round_final',{id:second.id});render();if(!$('#app').innerHTML.includes('Vincitore'))throw Error('winner');
  newMatch();if(!$('#modal').innerHTML.includes('Oratorio Don Bosco Arena'))throw Error('default field');
  let edited=state.matches[0];editMatch(edited.id);if(!$('#modal').innerHTML.includes('edit-match-date')||!$('#modal').innerHTML.includes('edit-b4'))throw Error('missing editing fields');
  user=11;showMatch(edited.id);if($('#modal').innerHTML.includes('Modifica partita'))throw Error('nonadmin edit button');user=0;
  await action('match_edit',{id:edited.id,date:'2026-10-15',time:'20:30',field:'Oratorio Don Bosco Arena',a:edited.a,b:edited.b});if(edited.time!=='20:30')throw Error('edit time');
  let before=p(0).goals;let m=state.matches[0],result={};for(let pid of [...m.a,...m.b])result[pid]={goals:pid===0?2:0,own:0,present:true};await action('result',{id:m.id,result});await action('result',{id:m.id,result});if(p(0).goals!==before+2)throw Error('double result');
  showMatch(m.id);if(!$('#modal').innerHTML.includes('Annulla partita'))throw Error('missing cancel');
  user=11;showMatch(m.id);if($('#modal').innerHTML.includes('Annulla partita'))throw Error('nonadmin cancel button');user=0;
  await action('match_cancel',{id:m.id,reason:'Pioggia'});if(p(0).goals!==before||!m.cancelled)throw Error('cancel statistics');
  showMatch(m.id);if(!$('#modal').innerHTML.includes('Partita annullata')||$('#modal').innerHTML.includes('Registra risultato')||$('#modal').innerHTML.includes('Correggi risultato'))throw Error('cancelled detail');
  await action('player',{name:'Ospite Occasionale',role:'Attaccante',occasional:true,email:''});let guest=state.players.at(-1);if(!guest.occasional)throw Error('guest');page='players';render();if(!$('#app').innerHTML.includes('Occasionale'))throw Error('guest label');
  if($('#identity').innerHTML.includes('Ospite Occasionale'))throw Error('guest login');

 })()`,c);
 const rollover=harness();await vm.runInContext(`(async()=>{
 user=0;for(const m of state.matches.filter(m=>!m.done&&!m.cancelled))await action('match_cancel',{id:m.id});
 const old=season,goals=p(0).goals;await action('season_start',{previous:old,name:'2026/2027',started_on:'2026-09-01'});
 if(season===old||p(0).goals!==0||state.matches.length)throw Error('new season reset');
 await changeSeason(old);if(!state.seasonInfo.closed_at||p(0).goals!==goals)throw Error('archive lost');
 if(await action('round_open',{season:old,award:'pollone'}))throw Error('archive mutable');
 user=11;page='awards';render();if($('#app').innerHTML.includes('Classifica riservata dal tuo admin'))throw Error('archive award hidden');if(!Object.values(state.closedAwards).flat().every(w=>$('#app').innerHTML.includes(w.name)))throw Error('missing winner');
 })()`,rollover.c);
 const formations=harness();await vm.runInContext(`(async()=>{
 user=0;const ids=state.players.slice(0,10).map(p=>p.id),balanced=balanceTeams(ids);
 if(balanced.a.length!==5||balanced.b.length!==5||new Set([...balanced.a,...balanced.b]).size!==10)throw Error('invalid balance');
 if(balanced.a.filter(id=>p(id).role==='Portiere').length!==1||balanced.b.filter(id=>p(id).role==='Portiere').length!==1)throw Error('goalkeepers not split');
 for(const id of ids)p(id).ratings=[60,60,60,60,60,60];const equal=balanceTeams(ids);for(const role of ['Attaccante','Regista','Difensore','Portiere'])if(Math.abs(equal.a.filter(id=>p(id).role===role).length-equal.b.filter(id=>p(id).role===role).length)>1)throw Error('unbalanced roles');
 draft={ids,mode:'manual',date:'2026-10-08',time:'21:00',field:'Arena'};manualTeamEditor();ids.forEach((id,i)=>$('#manual-team-'+id).value=i<5?'a':'b');applyManualTeams({preventDefault(){}});if(draft.a.join(',')!==ids.slice(0,5).join(','))throw Error('manual assignment');
 const m=state.matches[0],result=Object.fromEntries([...m.a,...m.b].map(id=>[id,{goals:id===m.a[0]?2:0,own:0,present:id!==m.b[0]}]));await action('result',{id:m.id,result});if(p(m.a[0]).wins!==1||p(m.b[0]).losses!==0)throw Error('result stats');
 p(1).goals=99;for(const pending of state.matches.filter(m=>!m.done&&!m.cancelled))await action('match_cancel',{id:pending.id});const old=season;await action('season_start',{previous:old,name:'Next',started_on:'2027-09-01'});const frozen=JSON.stringify(state.hallOfFame);
 const champion=state.hallOfFame[0].awards.goals[0];await action('player_delete',{id:champion.id});if(JSON.stringify(state.hallOfFame)!==frozen)throw Error('award changed after delete');
 user=11;page='hall';render();if(!$('#app').innerHTML.includes(champion.name)||!$('#app').innerHTML.includes('4 Pollari'))throw Error('hall hidden');
 })()`,formations.c);
 const online=harness(true);assert.ok(online.n('#app').innerHTML.includes('Accedi'));assert.ok(!online.n('#app').innerHTML.includes('32'));
 await vm.runInContext(`(async()=>{session={access_token:'test-session'};await rpc('club_action',{p_action:'vote',p_data:{round:1,candidate:1}})})()`,online.c);
 assert.equal(online.calls[0].args.headers.Authorization,'Bearer test-session');assert.ok(online.calls[0].url.endsWith('/rest/v1/rpc/club_action'));
 const snapshot=vm.runInContext("({...structuredClone(seed),user:0,season:2026,seasons:[2026],rounds:[]})",online.c);
 online.c.fetch=async()=>({ok:true,json:async()=>snapshot});
 await vm.runInContext('reload()',online.c);
 assert.ok(online.n('#app').innerHTML.includes('Ci vediamo in campo'));
 assert.ok(online.n('.identity').innerHTML.includes('Admin'));
 await vm.runInContext('reload()',online.c);
 assert.ok(online.n('#app').innerHTML.includes('Ci vediamo in campo'));
 console.log('PASS frontend: all screens, own statistics, demo secret voting, self vote, round reset, eliminated voters, winners, result corrections, online login gate and authenticated RPC');
})().catch(e=>{console.error(e);process.exit(1)});
