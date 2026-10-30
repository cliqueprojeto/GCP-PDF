import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const publication=import(pathToFileURL(resolve('scripts/publicar.mjs')).href);
async function cleanupTemporary(cwd:string) {
 const parent=await realpath(tmpdir()),target=await realpath(cwd);
 assert.ok(target.startsWith(parent+sep)&&/^gcp-(?:publication|command)-/.test(basename(target)),'A limpeza deve permanecer no diretório temporário criado pelo teste.');
 await rm(target,{recursive:true,force:true});
}
const MANAGED=['package.json','package-lock.json','assets/novidades.json','HISTORICO.md','NOVIDADES.md'];
type Call={command:string;args:string[];options:{capture:boolean;cwd:string}};
async function fixture(options:{fail?:string;remote?:string;indexed?:string[];commitChangedOnFailure?:boolean;omitPortable?:boolean;statusPaths?:string[]}={}) {
 const cwd=await mkdtemp(join(tmpdir(),'gcp-publication-'));await mkdir(join(cwd,'assets'));
 const original:Record<string,Buffer>={
  'package.json':Buffer.from('\uFEFF{\r\n "name":"gcp-pdf", "version":"0.3.4", "license":"UNLICENSED", "private":true\r\n}\r\n  '),
  'package-lock.json':Buffer.from('{"name":"gcp-pdf","version":"0.3.4","packages":{"":{"version":"0.3.4"}}}\r\n'),
  'assets/novidades.json':Buffer.from('[{"versao":"0.3.4","itens":["Histórico local ainda não salvo"]}]\r\n'),
  'HISTORICO.md':Buffer.from('# Histórico\r\n\r\nTexto local ainda não salvo.\r\n'),
  'NOVIDADES.md':Buffer.from('# Próxima versão\r\n- Corrigimos a publicação.\r\n- Texto com & e "aspas" não é comando.\r\n')
 };
 for(const [path,bytes]of Object.entries(original))await writeFile(join(cwd,path),bytes);
 await writeFile(join(cwd,'LICENSE'),'Licença proprietária. Todos os direitos reservados.\r\n');await writeFile(join(cwd,'THIRD_PARTY_NOTICES.md'),'Avisos obrigatórios dos componentes de terceiros.\r\n');
 const calls:Call[]=[],state={head:'original-head',staged:options.indexed??[],committed:false};
 const ok=(out='')=>({ok:true,status:0,out,err:''});const fail=(message='falha simulada')=>({ok:false,status:1,out:'',err:message});
 const runner=(command:string,args:string[],commandOptions:{capture:boolean;cwd:string})=>{
  calls.push({command,args:[...args],options:commandOptions});
  const step=command==='npm'&&args[0]==='run'?args[1]:args[0];
  if(command==='git') {
   if(args[0]==='rev-parse')return ok(args[1]==='--show-toplevel'?cwd:state.head);
   if(args[0]==='branch')return ok('main\n');
   if(args[0]==='remote')return ok(options.remote??'git@github.com:cliqueprojeto/GCP-PDF.git');
   if(args[0]==='diff')return ok(state.staged.map(path=>path+'\0').join(''));
   if(args[0]==='fetch')return options.fail==='fetch'?fail():ok();
   if(args[0]==='rev-list')return ok('0');
   if(args[0]==='tag'&&args[1]==='--list')return ok();
   if(args[0]==='status')return ok((options.statusPaths??['package.json','package-lock.json','assets/novidades.json','HISTORICO.md','NOVIDADES.md','src/ordinary.ts','HANDOFF.md','.cache/manual.pdf','evidence/customer.png','assets/client-token.txt']).map(path=>' M '+path+'\0').join(''));
   if(args[0]==='add'){if(options.fail==='add')return fail();state.staged=args.slice(args.indexOf('--')+1);return ok();}
   if(args[0]==='restore'){state.staged=[];return ok();}
   if(args[0]==='commit'){if(options.fail==='commit'){if(options.commitChangedOnFailure){state.head='new-head';state.committed=true;}return fail();}state.head='new-head';state.committed=true;state.staged=[];return ok();}
   if(args[0]==='tag')return options.fail==='tag'?fail():ok();
   if(args[0]==='push')return options.fail==='push'?fail():ok();
   throw new Error('Comando Git inesperado: '+JSON.stringify(args));
  }
  if(command==='gh'){if(args[0]==='auth')return ok();return options.fail==='release'?fail():ok();}
  if(command==='npm') {
   if(args[0]==='version'){
    for(const path of ['package.json','package-lock.json']){const object=JSON.parse(readFileSync(join(cwd,path),'utf8').replace(/^\uFEFF/,''));object.version=args[1];writeFileSync(join(cwd,path),JSON.stringify(object)+'\n');}
    return options.fail==='version'?fail():ok();
   }
   if(step==='typecheck'||step==='test')return options.fail===step?fail():ok();
   if(step==='pack:win'){
    if(options.fail==='pack:win')return fail();const version=JSON.parse(readFileSync(join(cwd,'package.json'),'utf8')).version;mkdirSync(join(cwd,'release'),{recursive:true});writeFileSync(join(cwd,`release/GCP-PDF-Instalador-${version}-x64.exe`),'synthetic installer');if(!options.omitPortable)writeFileSync(join(cwd,`release/GCP-PDF-Portatil-${version}-x64.exe`),'synthetic portable');return ok();
   }
  }
  throw new Error('Comando inesperado: '+command+' '+JSON.stringify(args));
 };
 const {runPublication}=await publication;
 const run=(argv=['correcao','--sim'],overrides:Record<string,unknown>={})=>runPublication({cwd,argv,runner,log:()=>{},ask:async()=>{throw new Error('Não deveria perguntar com --sim');},now:new Date('2026-10-30T02:00:00Z'),environment:{},...overrides});
 const assertRestored=async()=>{for(const path of MANAGED)assert.deepEqual(await readFile(join(cwd,path)),original[path],path);assert.equal(existsSync(join(cwd,'npm-shrinkwrap.json')),false);};
 return {cwd,original,calls,state,run,assertRestored,cleanup:()=>cleanupTemporary(cwd)};
}
test('remoto exige identidade exata do repositório e GitHub',async()=>{
 const {isExpectedRemote}=await publication;
 for(const remote of ['git@github.com:cliqueprojeto/GCP-PDF.git','https://github.com/cliqueprojeto/GCP-PDF','ssh://git@github.com/cliqueprojeto/GCP-PDF.git'])assert.equal(isExpectedRemote(remote),true,remote);
 for(const remote of ['https://evil.example/cliqueprojeto/GCP-PDF','https://github.com/other/GCP-PDF','https://github.com/cliqueprojeto/GCP-PDF-fork.git','https://github.com@evil.example/cliqueprojeto/GCP-PDF','https://github.com/cliqueprojeto/GCP-PDF?redirect=evil','https://user:secret@github.com/cliqueprojeto/GCP-PDF','https://github.com/cliqueprojeto%2fGCP-PDF'])assert.equal(isExpectedRemote(remote),false,remote);
});
test('ensaio restaura bytes originais inclusive BOM, CRLF e histórico local sujo',async()=>{
 const f=await fixture();try{const result=await f.run(['correcao','--sim','--ensaio']);assert.equal(result.ok,true);await f.assertRestored();assert.ok(!f.calls.some(c=>['commit','push'].includes(c.args[0])||c.command==='gh'&&c.args[0]==='release'));assert.ok(!f.calls.some(c=>c.command==='git'&&c.args[0]==='tag'&&c.args[1]==='-a'));assert.ok(existsSync(join(f.cwd,'release/novidades.md')));}finally{await f.cleanup();}
});
for(const step of ['fetch','typecheck','test','version','pack:win','add','commit'])test(`falha em ${step} é conferida e restaura os arquivos antes do commit`,async()=>{
 const f=await fixture({fail:step});try{const result=await f.run();assert.equal(result.ok,false);assert.equal(result.committed,false);await f.assertRestored();assert.ok(!f.calls.some(c=>c.args[0]==='push'||c.command==='gh'&&c.args[0]==='release'));if(step==='fetch')assert.ok(!f.calls.some(c=>c.command==='npm'));}finally{await f.cleanup();}
});
for(const step of ['tag','push','release'])test(`falha em ${step} após commit mantém versão/histórico e fornece recuperação`,async()=>{
 const f=await fixture({fail:step});try{const result=await f.run();assert.equal(result.ok,false);assert.equal(result.committed,true);assert.equal(JSON.parse(await readFile(join(f.cwd,'package.json'),'utf8')).version,'0.3.5');assert.match(await readFile(join(f.cwd,'HISTORICO.md'),'utf8'),/0\.3\.5/);assert.ok(result.recovery.some((line:string)=>line.includes('gh release view v0.3.5')));assert.ok(!f.calls.some(c=>['checkout','restore','reset','revert'].includes(c.args[0])));}finally{await f.cleanup();}
});
test('commit com retorno de erro mas HEAD alterado nunca dispara rollback',async()=>{
 const f=await fixture({fail:'commit',commitChangedOnFailure:true});try{const result=await f.run();assert.equal(result.committed,true);assert.equal(JSON.parse(await readFile(join(f.cwd,'package.json'),'utf8')).version,'0.3.5');assert.ok(!f.calls.some(c=>c.args[0]==='restore'));}finally{await f.cleanup();}
});
test('preparação é explícita e não inclui HANDOFF, evidências, cache ou credenciais',async()=>{
 const f=await fixture();try{const result=await f.run();assert.equal(result.ok,true);const add=f.calls.find(c=>c.command==='git'&&c.args[0]==='add')!;assert.ok(add.args.includes('src/ordinary.ts'));assert.ok(add.args.includes('package.json'));for(const privatePath of ['HANDOFF.md','.cache/manual.pdf','evidence/customer.png','assets/client-token.txt'])assert.ok(!add.args.includes(privatePath));assert.ok(add.args.includes('--'));const push=f.calls.find(c=>c.command==='git'&&c.args[0]==='push')!;assert.deepEqual(push.args,['push','--atomic','origin','main','v0.3.5']);const gh=f.calls.find(c=>c.command==='gh'&&c.args[0]==='release')!;assert.ok(gh.args.includes('--verify-tag'));assert.ok(gh.args.includes('cliqueprojeto/GCP-PDF'));assert.match(await readFile(join(f.cwd,'release/novidades.md'),'utf8'),/SHA-256 GCP-PDF-Instalador-0\.3\.5-x64\.exe: `[0-9a-f]{64}`/);assert.equal(JSON.parse(await readFile(join(f.cwd,'package.json'),'utf8')).license,'UNLICENSED');assert.equal(await readFile(join(f.cwd,'THIRD_PARTY_NOTICES.md'),'utf8'),'Avisos obrigatórios dos componentes de terceiros.\r\n');assert.match(await readFile(join(f.cwd,'LICENSE'),'utf8'),/proprietária/);assert.equal(JSON.parse(await readFile(join(f.cwd,'assets/novidades.json'),'utf8'))[0].data,'2026-10-29');}finally{await f.cleanup();}
});
test('não mistura arquivos previamente preparados pelo usuário',async()=>{
 const f=await fixture({indexed:['src/previous.ts']});try{const result=await f.run();assert.equal(result.ok,false);assert.match(result.error,/preparados/);assert.ok(!f.calls.some(c=>c.command==='npm'||c.args[0]==='add'));await f.assertRestored();assert.deepEqual(f.state.staged,['src/previous.ts']);}finally{await f.cleanup();}
});
test('portátil ausente interrompe a publicação e restaura a versão',async()=>{
 const f=await fixture({omitPortable:true});try{const result=await f.run();assert.equal(result.ok,false);assert.match(result.error,/Portatil/);await f.assertRestored();assert.ok(!f.calls.some(c=>c.args[0]==='commit'));}finally{await f.cleanup();}
});
test('rejeita argumentos desconhecidos e --sim sem tipo explícito',async()=>{
 const {parseArguments}=await publication;assert.throws(()=>parseArguments(['correcao','melhoria']),/somente um/);assert.throws(()=>parseArguments(['constructor']),/não reconhecida/);assert.throws(()=>parseArguments(['--novidades']),/Informe/);
 const f=await fixture();try{const result=await f.run(['--sim']);assert.equal(result.ok,false);assert.match(result.error,/escolha correcao/);await f.assertRestored();}finally{await f.cleanup();}
});
test('runner passa metacaracteres como argumento literal, sem executar shell',async()=>{
 const {commandRunner}=await publication;const cwd=await mkdtemp(join(tmpdir(),'gcp-command-'));
 try{await writeFile(join(cwd,'args.mjs'),'console.log(JSON.stringify(process.argv.slice(2)))');const payload='texto & echo INVADIDO > shell-marker.txt';const result=commandRunner(process.execPath,[join(cwd,'args.mjs'),payload,'"aspas"'],{cwd,capture:true});assert.equal(result.ok,true);assert.deepEqual(JSON.parse(result.out),[payload,'"aspas"']);assert.equal(existsSync(join(cwd,'shell-marker.txt')),false);}finally{await cleanupTemporary(cwd);}
});



test('confirmação vazia nunca autoriza publicação ou geração de instaladores',async()=>{
 const f=await fixture();try{const result=await f.run(['correcao'],{ask:async()=>''});assert.equal(result.ok,false);assert.match(result.error,/necessário responder s/);assert.ok(!f.calls.some(call=>call.command==='npm'||call.args[0]==='commit'||call.args[0]==='push'));await f.assertRestored();}finally{await f.cleanup();}
});
for(const flag of ['npm_config_ensaio','npm_config_sim','npm_config_sem_testes','npm_config_novidades','npm_config__sim','npm_config___ensaio','NPM_CONFIG___SEM_TESTES'])test(`opção ${flag} absorvida pelo npm interrompe antes de qualquer comando`,async()=>{
 const f=await fixture();try{const result=await f.run(['correcao','--sim'],{environment:{[flag]:'true'}});assert.equal(result.ok,false);assert.match(result.error,/npm absorveu/);assert.match(result.error,/npm\.cmd/);assert.equal(f.calls.length,0);await f.assertRestored();}finally{await f.cleanup();}
});
test('CLI real com stdin em EOF aborta antes de acessar ferramentas ou alterar arquivos',async()=>{
 const f=await fixture();try{
  const environment={...process.env};for(const key of Object.keys(environment))if(/^npm_config_/i.test(key)&&/sim|ensaio|novidades|sem[_-]*testes/i.test(key))delete environment[key];
  const result=spawnSync(process.execPath,[resolve('scripts/publicar.mjs'),'correcao'],{cwd:f.cwd,input:'',encoding:'utf8',env:environment,shell:false,windowsHide:true,timeout:15000});
  assert.equal(result.status,1);assert.match(result.stderr+result.stdout,/Entrada encerrada sem confirmação/);assert.doesNotMatch(result.stderr+result.stdout,/geração|GitHub não está conectado|não é um repositório/);assert.equal(existsSync(join(f.cwd,'release')),false);await f.assertRestored();
 }finally{await f.cleanup();}
});
test('CLI real detecta --ensaio absorvido mesmo quando --sim chegou ao script',async()=>{
 const f=await fixture();try{const result=spawnSync(process.execPath,[resolve('scripts/publicar.mjs'),'correcao','--sim'],{cwd:f.cwd,input:'',encoding:'utf8',env:{...process.env,npm_config_ensaio:'true'},shell:false,windowsHide:true,timeout:15000});assert.equal(result.status,1);assert.match(result.stdout+result.stderr,/npm absorveu/);assert.equal(existsSync(join(f.cwd,'release')),false);await f.assertRestored();}finally{await f.cleanup();}
});


test('opções absorvidas são diagnosticadas antes de um valor avulso deixado pelo shim',async()=>{
 const f=await fixture();try{const result=await f.run(['correcao','x.md'],{environment:{npm_config_novidades:'x.md'}});assert.equal(result.ok,false);assert.match(result.error,/npm absorveu/);assert.equal(f.calls.length,0);await f.assertRestored();}finally{await f.cleanup();}
});
test('a release leva atualizacao.json com versão, instalador, tamanho e SHA-256 para o atualizador',async()=>{
 const f=await fixture();try{const result=await f.run();assert.equal(result.ok,true);
  const gh=f.calls.find(c=>c.command==='gh'&&c.args[0]==='release')!;assert.ok(gh.args.includes('release/atualizacao.json'));
  const manifest=JSON.parse(await readFile(join(f.cwd,'release','atualizacao.json'),'utf8'));
  const installer=await readFile(join(f.cwd,`release/${manifest.assetName}`));
  assert.equal(manifest.version,result.version);assert.match(manifest.assetName,/^GCP-PDF-Instalador-[\d.]+-x64\.exe$/);assert.equal(manifest.size,installer.byteLength);
  assert.equal(manifest.sha256,createHash('sha256').update(installer).digest('hex'));assert.ok(manifest.notes.startsWith('- '));
 }finally{await f.cleanup();}
});
