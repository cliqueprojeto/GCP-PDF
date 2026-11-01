import {setTimeout as delay} from 'node:timers/promises';
/** Await IPC in Node: a Promise returned from a browser polling expression must not count as success. */
async function waitForState(page,read,matches,timeout){
 let state;
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  state=await page.evaluate(read);
  if(state&&matches(state))return state;
  await delay(50);
 }
 throw new Error('Desktop state did not become ready: '+JSON.stringify(state));
}
export const waitForWorkspace=(page,matches,timeout=30000)=>waitForState(page,()=>window.gcp?.getWorkspace(),matches,timeout);
export const waitForQuickState=(page,matches,timeout=30000)=>waitForState(page,()=>window.gcp?.getQuickState(),matches,timeout);
