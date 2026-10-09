import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { COACH_VOICES, createPremiumSpeechPlayer } from '../public/premium-speech.js';
import { createSourcedVoiceCoach } from '../public/sourced-voice.js';
const results=[], only=process.env.QA_SCOPES?new Set(process.env.QA_SCOPES.split(',').map(Number)):null;
let scope=0;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function audioResponse(body,{count=1,index=body.chunkIndex||0,voice=body.voice,headers={}}={}){return new Response('ID3mock-premium-audio',{headers:{'Content-Type':'audio/mpeg','X-Study-Speech-Chunks':String(count),'X-Study-Speech-Chunk':String(index),'X-Study-Speech-Voice':voice,'X-Study-Speech-Model':'gpt-4o-mini-tts',...headers}});}
function harness(fetcher){
 const document=new EventTarget();document.hidden=false;
 const window=new EventTarget();window.Audio=class{constructor(url){this.url=url;this.plays=0;this.pauses=0;audio.push(this);}async play(){this.plays++;if(block){block=false;throw Object.assign(new Error('gesture required'),{name:'NotAllowedError'});}this.onplaying?.();}pause(){this.pauses++;}removeAttribute(){}load(){}};
 const calls=[],audio=[],revoked=[],states=[];let block=false,unauthorized=0;
 window.URL={createObjectURL:()=>`blob:qa-${audio.length}`,revokeObjectURL:url=>revoked.push(url)};window.crypto=crypto;window.AbortController=AbortController;window.isSecureContext=true;window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;
 window.speechSynthesis={cancel(){},speak(){throw Error('A device voice must never be used');}};
 const player=createPremiumSpeechPlayer({windowImpl:window,documentImpl:document,getVoice:()=> 'marin',onState:state=>states.push(state),onUnauthorized:()=>unauthorized++,fetchImpl:async(path,options)=>{const body=JSON.parse(options.body);calls.push({path,body,signal:options.signal,credentials:options.credentials});return fetcher?fetcher(body,options,calls.length):audioResponse(body);}});
 return{window,document,player,calls,audio,revoked,states,block(){block=true;},unauthorized:()=>unauthorized};
}
async function check(name,run){const index=scope++;if(only&&!only.has(index))return;try{await run();results.push({scope:index,name,pass:true});console.log(JSON.stringify(results.at(-1)));}catch(error){results.push({scope:index,name,pass:false,error:error.stack});console.log(JSON.stringify({scope:index,name,pass:false,error:error.message}));}}
await check('five voices, Marin default, fixed preview identity and memory replay without another API call',async()=>{
 assert.deepEqual(COACH_VOICES.map(v=>v.id),['marin','cedar','coral','sage','ash']);const h=harness();
 try{for(const voice of COACH_VOICES){await h.player.preview({voice:voice.id});const call=h.calls.at(-1);assert.equal(call.path,'/api/voice/preview');assert.deepEqual(Object.keys(call.body).sort(),['requestId','voice']);assert.equal(call.body.voice,voice.id);assert.match(call.body.requestId,/^[0-9a-f-]{36}$/);assert.equal(call.credentials,'same-origin');h.audio.at(-1).onended();}
 await h.player.preview({});assert.equal(h.player.state().voice,'marin');assert.equal(h.calls.length,5);h.audio.at(-1).onended();await assert.rejects(()=>h.player.preview({voice:'unlisted'}),/five Coach voices/);assert.equal(h.calls.length,5);
 }finally{h.player.destroy();}
});
await check('every server chunk is requested by saved identity and played to completion without client text or truncation',async()=>{
 const h=harness(body=>audioResponse(body,{count:8}));let finished=0;
 try{await h.player.play({conversationId:'saved-conversation',messageId:'saved-reply',voice:'cedar',onEnd:()=>finished++});for(let index=0;index<8;index++){assert.equal(h.calls.length,index+1);assert.deepEqual(Object.keys(h.calls[index].body).sort(),['chunkIndex','conversationId','messageId','requestId','voice']);assert.equal(h.calls[index].body.chunkIndex,index);assert.equal(h.calls[index].body.voice,'cedar');assert.equal(finished,0);h.audio[index].onended();await tick();}assert.equal(finished,1);assert.equal(h.calls.length,8);assert.equal(new Set(h.calls.map(call=>call.body.requestId)).size,8);assert.equal(h.revoked.length,8);assert.equal(h.player.active(),false);
 }finally{h.player.destroy();}
});
await check('mobile autoplay resumes the same prepared buffer without another API request',async()=>{
 const h=harness();h.block();let blocked=0,started=0,finished=0;
 try{await h.player.play({conversationId:'saved',messageId:'reply',onBlocked:()=>blocked++,onStart:()=>started++,onEnd:()=>finished++});assert.equal(blocked,1);assert.equal(h.player.state().audioBlocked,true);assert.equal(h.calls.length,1);assert.equal(h.audio.length,1);await h.player.resume();assert.equal(h.calls.length,1);assert.equal(h.audio.length,1);assert.equal(h.audio[0].plays,2);assert.equal(started,1);h.audio[0].onended();assert.equal(finished,1);
 }finally{h.player.destroy();}
});
await check('stop, replacement, background and page departure discard delayed or stale audio',async()=>{
 const pending=[];const h=harness((body)=>{const wait=deferred();pending.push({body,wait});return wait.promise;});
 try{const first=h.player.play({conversationId:'one',messageId:'first'});h.player.stop();pending[0].wait.resolve(audioResponse(pending[0].body));await first;assert.equal(h.audio.length,0);assert(h.calls[0].signal.aborted);
 const second=h.player.play({conversationId:'two',messageId:'second'}),third=h.player.play({conversationId:'three',messageId:'third'});pending[1].wait.resolve(audioResponse(pending[1].body));pending[2].wait.resolve(audioResponse(pending[2].body));await Promise.all([second,third]);assert.equal(h.audio.length,1);const staleEnd=h.audio[0].onended;h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));assert.equal(h.player.active(),false);staleEnd();assert.equal(h.calls.length,3);assert.equal(h.revoked.length,1);
 h.document.hidden=false;const fourth=h.player.preview({voice:'ash'});h.window.dispatchEvent(new Event('pagehide'));pending[3].wait.resolve(audioResponse(pending[3].body));await fourth;assert.equal(h.audio.length,1);
 }finally{h.player.destroy();}
});
await check('malformed, unavailable, uncertain and expired sessions never retry or substitute a device voice',async()=>{
 for(const scenario of ['missing-index','wrong-voice','missing-type','409','401']){const h=harness(body=>scenario==='409'||scenario==='401'?Response.json({error:'Explicit retry or sign-in is required.'},{status:Number(scenario)}):audioResponse(body,{headers:scenario==='missing-index'?{'X-Study-Speech-Chunk':''}:scenario==='wrong-voice'?{'X-Study-Speech-Voice':'ash'}:{'Content-Type':'application/json'}}));let errors=0;
 try{await h.player.play({conversationId:'saved',messageId:'reply',onError:()=>errors++});await h.player.resume();assert.equal(h.calls.length,1,scenario);assert.equal(h.audio.length,0,scenario);assert.equal(h.player.active(),false);assert.equal(scenario==='401'?h.unauthorized():errors,1);
 }finally{h.player.destroy();}}
});
await check('continuous coaching stops recognition before speech generation, waits for all chunks and respects microphone mute',async()=>{
 const h=harness(body=>audioResponse(body,{count:2})),recognitions=[],turns=[];
 h.window.SpeechRecognition=class{constructor(){recognitions.push(this);}start(){queueMicrotask(()=>this.onstart?.());}stop(){this.stopped=true;queueMicrotask(()=>this.onend?.());}abort(){this.aborted=true;}};
 const coach=createSourcedVoiceCoach({windowImpl:h.window,documentImpl:h.document,navigatorImpl:{language:'en-US'},speechPlayer:h.player,sendTurn:async turn=>{assert.equal(recognitions[0].stopped,true);turns.push(turn);return{messageId:'saved-reply',content:'Checked complete reply.',readoutAllowed:true};}});
 try{await coach.start({conversationId:'saved'});await tick();const result=Object.assign([{transcript:'Can we chat?'}],{isFinal:true});recognitions[0].onresult({resultIndex:0,results:[result]});recognitions[0].onresult?.({resultIndex:0,results:[result]});await tick();assert.equal(turns.length,1);assert.equal(h.calls.length,1);assert.equal(recognitions.length,1);assert.equal(coach.state().phase,'speaking');coach.toggleMute();assert.equal(coach.state().muted,true);h.audio[0].onended();await tick();assert.equal(recognitions.length,1);h.audio[1].onended();await tick();assert.equal(coach.state().phase,'paused');assert.equal(recognitions.length,1);coach.toggleMute();await tick();assert.equal(recognitions.length,2);assert.equal(coach.state().phase,'listening');
 }finally{coach.destroy();h.player.destroy();}
});
await check('continuous autoplay resume, interrupt and background prevent stale audio and microphone overlaps',async()=>{
 const waiting=deferred();let hold=false;const h=harness(body=>hold?waiting.promise:audioResponse(body)),recognitions=[];h.block();
 h.window.SpeechRecognition=class{constructor(){recognitions.push(this);}start(){queueMicrotask(()=>this.onstart?.());}stop(){queueMicrotask(()=>this.onend?.());}abort(){this.aborted=true;}};
 const coach=createSourcedVoiceCoach({windowImpl:h.window,documentImpl:h.document,navigatorImpl:{language:'en-US'},speechPlayer:h.player,sendTurn:async()=>({messageId:'saved',content:'Reviewed reply.',readoutAllowed:true})});
 const final=()=>recognitions.at(-1).onresult({resultIndex:0,results:[Object.assign([{transcript:'hello'}],{isFinal:true})]});
 try{await coach.start({conversationId:'saved'});await tick();final();await tick();assert.equal(coach.state().audioBlocked,true);assert.equal(recognitions.length,1);await coach.playAudio();assert.equal(h.calls.length,1);h.audio[0].onended();await tick();assert.equal(recognitions.length,2);
 hold=true;final();await tick();const count=h.calls.length;coach.interrupt();await tick();assert.equal(coach.state().phase,'listening');assert.equal(h.calls.at(-1).signal.aborted,true);waiting.resolve(audioResponse(h.calls.at(-1).body));await tick();assert.equal(h.audio.length,1);assert.equal(h.calls.length,count);h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));assert.equal(coach.active(),false);assert.equal(recognitions.at(-1).aborted,true);
 }finally{coach.destroy();h.player.destroy();}
});
const ledger={runAt:new Date().toISOString(),scope:'Novel premium player and injected continuous-controller paths only. Mocked authenticated fetch, MP3 and media; no physical phone audio or quality result claimed.',paidProviderCalls:0,results};
writeFileSync(new URL(only?`./premium-speech-player-results-scopes-${[...only].join('-')}.json`:'./premium-speech-player-results.json',import.meta.url),JSON.stringify(ledger,null,2));if(results.some(result=>!result.pass))process.exitCode=1;
