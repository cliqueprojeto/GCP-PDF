import {setTimeout as delay} from 'node:timers/promises';
/** Await IPC in Node: a Promise returned from a browser polling expression must not count as success. */
export async function waitForWorkspace(page,matches,timeout=30000){
 let state;
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  state=await page.evaluate(()=>window.gcp?.getWorkspace());
  if(state&&matches(state))return state;
  await delay(50);
 }
 throw new Error('Workspace did not reach the expected state: '+JSON.stringify(state));
}
