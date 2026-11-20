import test from 'node:test';
import assert from 'node:assert/strict';
import {queueEdit, snapshotPage} from '../src/sharedQueueWire.ts';
import type {QueueEntry, QueueSnapshot} from '../src/audio.ts';

const entry = (n: number): QueueEntry => ({entryId: String(n), id: String(n), artist:'Artist', albumName:null,
  title:'a'.repeat(4000), artworkPath:null, durationMs:60000, streamPath:'/api/playlists/stream/'+n, transcode:true, pinned:false});
const tracks = Array.from({length:60},(_,i)=>entry(i));
const mock = async (offset:number,limit:number):Promise<QueueSnapshot>=>({
  sessionId:'session', revision:7,index:3,total:tracks.length,positionMs:23000,durationMs:60000,
  playing:true,buffering:false,canSeek:true,shuffle:true,flowId:null,flowName:null,collectionId:'p',id:'3',
  title:'Playing',artist:'Artist',currentEntryId:'3',upNext:[],message:null,previous:true,next:true,
  albumName:null,artworkPath:null,offset,entries:tracks.slice(offset,offset+limit),
});
test('large snapshots page by encoded bytes and preserve every queue occurrence',async()=>{
  const ids=[];
  while(ids.length<tracks.length){
    const page=await snapshotPage({offset:ids.length,sessionId:'session',revision:7},mock);
    assert.ok(page.entries.length>0 && page.entries.length<48);
    assert.ok(new TextEncoder().encode(JSON.stringify(page)).length<96_000);
    ids.push(...page.entries.map(t=>t.entryId));
  }
  assert.deepEqual(ids,tracks.map(t=>t.entryId));
});
test('position changes sync without queue retransmission and stale page requests fail',async()=>{
  const same=await snapshotPage({knownSessionId:'session',knownRevision:7},mock);
  assert.equal(same.unchanged,true); assert.equal(same.positionMs,23000); assert.deepEqual(same.entries,[]);
  await assert.rejects(snapshotPage({sessionId:'other',revision:7,offset:1},mock));
  await assert.rejects(snapshotPage({sessionId:'session',revision:8,offset:1},mock));
  assert.equal((await snapshotPage({knownSessionId:'session',knownRevision:5},mock)).unchanged,false);
});
test('mutation input requires concrete identifiers and validates guarded handoff',()=>{
  const move={action:'move',sessionId:'session',entryId:'entry',beforeEntryId:null};
  assert.deepEqual(queueEdit(move,()=>tracks[0]),move);
  for(const fields of [{...move,entryId:''},{...move,beforeEntryId:3},{action:'handoffPause',sessionId:'x',entryId:'y',revision:5.5},
    {action:'shuffle',sessionId:'x',enabled:'false'},{action:'enqueue',sessionId:'x',placement:'next',tracks:[]}]){
    assert.throws(()=>queueEdit(fields,()=>tracks[0]));
  }
});
