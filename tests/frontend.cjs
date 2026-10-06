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
  user=0;page='votes';render();await openFirstRound('pollone');let first=currentRounds('pollone')[0];await action('vote',{round:first.id,candidate:0});if(!hasVoted(first))throw Error('self vote');let count=first.count;await action('vote',{round:first.id,candidate:1});if(first.count!==count)throw Error('duplicate');await action('round_close',{id:first.id});await action('round_open',{season,award:'pollone',candidates:[0,1]});let second=currentRounds('pollone')[1];if(second.count||hasVoted(second))throw Error('reset');user=11;await action('vote',{round:second.id,candidate:0});if(!hasVoted(second))throw Error('eliminated voter');user=0;await action('round_close',{id:second.id});await action('round_final',{id:second.id});render();if(!$('#app').innerHTML.includes('Vincitore'))throw Error('winner');
  let before=p(0).goals;let m=state.matches[0],result={};for(let pid of [...m.a,...m.b])result[pid]={goals:pid===0?2:0,own:0,present:true};await action('result',{id:m.id,result});await action('result',{id:m.id,result});if(p(0).goals!==before+2)throw Error('double result');
 })()`,c);
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
