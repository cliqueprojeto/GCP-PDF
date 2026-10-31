import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneObjects} from '../src/shared/object-clipboard';
import type {PageObject} from '../src/shared/types';

const rect:PageObject={id:'a',page:'p1',kind:'shape',shape:'rect',x:10,y:20,width:50,height:30,stroke:'#000000',fill:'#ff9900',strokeWidth:2,opacity:1};
const ink:PageObject={id:'b',page:'p1',kind:'ink',points:[{x:5,y:5},{x:15,y:25}],stroke:'#000000',strokeWidth:1,opacity:1};
const note:PageObject={id:'c',page:'p1',kind:'note',x:1,y:1,width:20,height:20,text:'Nota',author:'Ana',createdAt:'2026-10-31T00:00:00Z',color:'#ffd43b'};

test('copies get new ids, the target page and an offset; originals stay untouched',()=>{
 let n=0;const copies=cloneObjects([rect,ink,note],'p2',14,()=>`n${++n}`);
 assert.deepEqual(copies.map(o=>o.id),['n1','n2']);
 assert.ok(copies.every(o=>o.page==='p2'));
 assert.equal((copies[0] as typeof rect).x,24);
 assert.deepEqual((copies[1] as typeof ink).points[0],{x:19,y:19});
 assert.equal((ink as typeof ink).points[0]!.x,5);
});

test('a paste on a smaller page is pulled back inside it',()=>{
 const copies=cloneObjects([{...rect,x:500,y:780}],'p2',14,()=>'x',{width:595,height:842});
 const o=copies[0] as typeof rect;
 assert.ok(o.x+o.width<=595&&o.y+o.height<=842,`${o.x},${o.y}`);
});
