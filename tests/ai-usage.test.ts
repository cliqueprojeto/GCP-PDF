import test from 'node:test';
import assert from 'node:assert/strict';
import {recordUsage,usageToday} from '../src/shared/ai-usage';
import {requestAnswer} from '../src/main/ai';
test('contagem local separa respostas, limites e falhas e reinicia por dia',()=>{
 let value=recordUsage(undefined,200,'2026-10-30');
 value=recordUsage(value,429,'2026-10-30');value=recordUsage(value,0,'2026-10-30');
 assert.deepEqual(value,{day:'2026-10-30',requests:3,responses:1,limited:1,failures:1});
 assert.deepEqual(usageToday(value,'2026-10-31'),{day:'2026-10-31',requests:0,responses:0,limited:0,failures:0});
});
const config={provider:'gemini',model:'teste',baseUrl:'https://generativelanguage.googleapis.com/v1beta',hasKey:true} as const;
for(const [body,message] of [['{"error":{"code":"insufficient_quota"}}',/créditos/],['{"error":{"message":"quota PerDay exceeded"}}',/diárias/],['{}',/pausa/]] as const){
 test('limite de IA recebe mensagem em português: '+message,async()=>{
  await assert.rejects(requestAnswer(config,'ficticia','Resuma','Texto',(async()=>new Response(body,{status:429})) as typeof fetch),message);
 });
}
test('resposta inválida do provedor tem mensagem em português',async()=>{
 await assert.rejects(requestAnswer(config,'ficticia','Resuma','Texto',(async()=>new Response('not-json')) as typeof fetch),/resposta inválida/);
});

test('resposta fora do formato esperado nunca expõe TypeError em inglês',async()=>{
 for(const body of ['null','{"candidates":[{"content":{"parts":{}}}]}'])await assert.rejects(requestAnswer(config,'ficticia','Resuma','Texto',(async()=>new Response(body)) as typeof fetch),/resposta inválida|não retornou/);
});
