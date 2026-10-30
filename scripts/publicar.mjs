/** Publicação local revisável: Publicar-GCP-PDF.cmd correcao. Nenhum comando usa shell. */
import {readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {stdin,stdout} from 'node:process';

export const REPOSITORY='cliqueprojeto/GCP-PDF';
export const MODELO=`# Novidades da próxima versão

Escreva uma novidade por linha, em português simples, começando com "- ".
Este texto aparece na atualização e na primeira abertura da versão nova.

Escreva aqui embaixo:

`;
const VERSION_FILES=['package.json','package-lock.json','npm-shrinkwrap.json','assets/novidades.json','HISTORICO.md','NOVIDADES.md'];
const SOURCE_ROOTS=new Set(['src','scripts','tests','docs','assets','native','packaging','vendor']);
const SOURCE_FILES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','HISTORICO.md','NOVIDADES.md','README.md','LICENSE','THIRD_PARTY_NOTICES.md','tsconfig.json','vite.config.ts','.gitignore','Testar-GCP-PDF.cmd','Publicar-GCP-PDF.cmd']);
const json=text=>JSON.parse(text.replace(/^\uFEFF/,''));
class PublicationError extends Error {}
const stop=message=>{throw new PublicationError(message);};
export function isExpectedRemote(remote) {
 if(/^git@github\.com:cliqueprojeto\/GCP-PDF(?:\.git)?$/i.test(remote))return true;
 try {const u=new URL(remote);return ['https:','ssh:'].includes(u.protocol)&&u.hostname.toLowerCase()==='github.com'&&!u.password&&!u.search&&!u.hash&&(!u.port||(u.protocol==='ssh:'&&u.port==='22'))&&(u.protocol==='ssh:'?u.username==='git':!u.username)&&/^\/cliqueprojeto\/GCP-PDF(?:\.git)?$/i.test(u.pathname);}catch{return false;}
}
export function isPrivatePath(path) {
 const normalized=path.replaceAll('\\','/'),parts=normalized.split('/');
 return parts.some(part=>/^(?:\.git|\.cache|evidence|release|dist|node_modules|HANDOFF\.md)$/i.test(part)||/^\.env(?:\.|$)/i.test(part)||/^(?:preferences\.json|\.npmrc)$/i.test(part)||/secret|token/i.test(part)||/\.(?:key|pem|pfx|p12|p7b|cer|crt|jks|keystore|log)$/i.test(part));
}
export function canStagePath(path) {
 const p=path.replaceAll('\\','/');
 return !p.startsWith('/')&&!p.split('/').includes('..')&&!isPrivatePath(p)&&(SOURCE_FILES.has(p)||SOURCE_ROOTS.has(p.split('/')[0]));
}
export function absorbedPublicationFlags(environment=process.env) {
 return Object.keys(environment).filter(key=>/^npm_config_/i.test(key)&&['ensaio','sim','semtestes','novidades'].includes(key.replace(/^npm_config_+/i,'').replace(/[-_]/g,'').toLowerCase()));
}
export function parseArguments(argv) {
 const result={ensaio:false,semTestes:false,sim:false,help:false,tipo:undefined,novidades:undefined};
 for(let i=0;i<argv.length;i++) {
  const arg=argv[i];
  if(['correcao','melhoria','grande'].includes(arg)){if(result.tipo)stop('Escolha somente um tipo de versão.');result.tipo=arg;}
  else if(arg==='--ensaio')result.ensaio=true;
  else if(arg==='--sem-testes')result.semTestes=true;
  else if(arg==='--sim')result.sim=true;
  else if(arg==='--help'||arg==='-h')result.help=true;
  else if(arg==='--novidades'){if(!argv[i+1]||argv[i+1].startsWith('--'))stop('Informe um arquivo depois de --novidades.');result.novidades=argv[++i];}
  else stop(`Opção não reconhecida: ${arg}`);
 }
 return result;
}
function npmCli() {
 const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')];
 const cli=candidates.find(p=>p&&/\.[cm]?js$/i.test(p)&&existsSync(p));
 if(!cli)stop('Não encontrei o npm-cli.js. Execute este comando por npm.cmd run publicar ou pelo Publicar-GCP-PDF.cmd.');
 return cli;
}
/** Native executables receive an argument array; npm runs directly through Node, including Windows. */
export function commandRunner(command,args,{cwd,capture=false}={}) {
 const executable=command==='npm'?process.execPath:command;
 const parameters=command==='npm'?[npmCli(),...args]:args;
 const result=spawnSync(executable,parameters,{cwd,shell:false,windowsHide:true,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:'utf8'});
 return {ok:!result.error&&result.status===0,status:result.status,out:result.stdout??'',err:result.error?.message??result.stderr??''};
}
function changedPaths(output) {
 const records=output.split('\0'),paths=[];
 for(let i=0;i<records.length;i++) {
  const record=records[i];if(!record)continue;
  if(record.length<4)stop('A lista de alterações do Git não pôde ser interpretada.');
  paths.push(record.slice(3));
  if(/[RC]/.test(record.slice(0,2))){const original=records[++i];if(!original)stop('Renomeação incompleta na lista do Git.');paths.push(original);}
 }
 return [...new Set(paths)];
}
async function snapshotFiles(cwd) {
 const snapshots=new Map();
 for(const path of VERSION_FILES){try{snapshots.set(path,await readFile(join(cwd,path)));}catch(error){if(error.code!=='ENOENT')throw error;snapshots.set(path,null);}}
 return snapshots;
}
async function restoreFiles(cwd,snapshots) {
 for(const [path,bytes]of snapshots){if(bytes===null)await rm(join(cwd,path),{force:true});else await writeFile(join(cwd,path),bytes);}
}
async function readNews(cwd,path) {
 let text;try{text=await readFile(resolve(cwd,path??'NOVIDADES.md'),'utf8');}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const marker=text.indexOf('Escreva aqui embaixo');
 if(marker>=0)text=text.slice(text.indexOf('\n',marker)+1);
 return text.split(/\r?\n/).map(l=>l.trim()).filter(l=>/^[-*•]\s+\S/.test(l)).map(l=>l.replace(/^[-*•]\s+/,''));
}
function dateParts(now) {
 const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=type=>parts.find(p=>p.type===type)?.value;
 return {iso:`${get('year')}-${get('month')}-${get('day')}`,display:`${get('day')}/${get('month')}/${get('year')}`};
}
async function saveHistory(cwd,version,items,now) {
 const asset=join(cwd,'assets','novidades.json');let list=[];
 try{list=json(await readFile(asset,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!Array.isArray(list))stop('assets/novidades.json precisa conter uma lista de versões.');
 const date=dateParts(now);await mkdir(dirname(asset),{recursive:true});
 await writeFile(asset,JSON.stringify([{versao:version,data:date.iso,itens:items},...list.filter(v=>v.versao!==version)].slice(0,50),null,2)+'\n');
 let history='# Histórico de versões do GCP-PDF\n';try{history=await readFile(join(cwd,'HISTORICO.md'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const first=history.indexOf('\n'),title=first<0?history:history.slice(0,first);
 await writeFile(join(cwd,'HISTORICO.md'),`${title}\n\n## ${version} — ${date.display}\n\n${items.map(i=>`- ${i}`).join('\n')}\n${first<0?'':history.slice(first)}`);
}
function nextVersion(current,type) {
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(current))stop('package.json precisa ter uma versão estável no formato 0.3.4.');
 const [major,minor,patch]=current.split('.').map(Number);
 if(![major,minor,patch].every(Number.isSafeInteger))stop('O número de versão é inválido.');
 return {correcao:`${major}.${minor}.${patch+1}`,melhoria:`${major}.${minor+1}.0`,grande:`${major+1}.0.0`}[type];
}
export async function runPublication({cwd=process.cwd(),argv=process.argv.slice(2),runner=commandRunner,ask=async()=>'',log=console.log,now=new Date(),environment=process.env}={}) {
 cwd=resolve(cwd);let snapshots,committed=false,commitAttempted=false,originalHead,version,staged=[],phase='preparação',recovery=[];
 const run=(command,args,capture=true)=>runner(command,args,{cwd,capture});
 const checked=(command,args,message,capture=true,trim=true)=>{const result=run(command,args,capture);if(!result.ok)stop(`${message}${result.err?.trim()?`\n${result.err.trim()}`:''}`);return trim?result.out.trim():result.out;};
 const git=(args,message)=>checked('git',args,message);
 try {
  if(!argv.includes('--help')&&!argv.includes('-h'))if(absorbedPublicationFlags(environment).length)stop('O npm absorveu opções destinadas à publicação. Nenhuma etapa foi executada. No PowerShell, use .\\Publicar-GCP-PDF.cmd correcao --ensaio ou npm.cmd run publicar -- correcao --ensaio. Para publicar sem perguntas, troque --ensaio por --sim.');
  const options=parseArguments(argv);
  if(options.help){log('.\\Publicar-GCP-PDF.cmd [correcao|melhoria|grande] [--ensaio] [--sim] [--novidades arquivo.md] [--sem-testes]');log('Alternativa no PowerShell: npm.cmd run publicar -- correcao --sim');return {ok:true,help:true};}
  log(`\nGCP-PDF · Publicar nova versão${options.ensaio?' (ensaio: nada será enviado)':''}`);
  phase='verificação do repositório';
  const top=git(['rev-parse','--show-toplevel'],'Esta pasta não é um repositório Git.');
  if((await realpath(top)).toLowerCase()!==(await realpath(cwd)).toLowerCase())stop('Execute dentro da pasta gcp-pdf, que possui seu próprio repositório Git.');
  const branch=git(['branch','--show-current'],'Não consegui consultar o ramo atual.');
  if(branch!=='main')stop(`Você está no ramo "${branch}". Volte para main antes de publicar.`);
  originalHead=git(['rev-parse','HEAD'],'Não consegui consultar a revisão atual.');
  const remote=git(['remote','get-url','origin'],'O remoto origin não está configurado.');
  if(!isExpectedRemote(remote))stop(`O remoto origin deve apontar exatamente para github.com/${REPOSITORY}.`);
  const indexed=checked('git',['diff','--cached','--name-only','-z'],'Não consegui verificar os arquivos preparados.',true,false);
  if(indexed)stop('Já há arquivos preparados no Git. Faça seu commit ou retire-os da área de preparação antes de publicar.');
  checked('gh',['auth','status'],'O GitHub não está conectado. Execute gh auth login.');
  if(!options.ensaio){
   git(['fetch','--quiet','--tags','origin','main'],'Não consegui atualizar as referências do GitHub. Nada será publicado.');
   const count=git(['rev-list','--count','HEAD..origin/main'],'Não consegui comparar o código com origin/main.');
   if(!/^\d+$/.test(count))stop('A comparação com origin/main retornou um resultado inválido.');
   if(Number(count)>0)stop('O GitHub tem alterações ainda não baixadas. Atualize o repositório antes de publicar.');
  }
  phase='escolha da versão';
  const pkg=json(await readFile(join(cwd,'package.json'),'utf8'));
  let type=options.tipo;
  if(!type){if(options.sim)stop('Com --sim, escolha correcao, melhoria ou grande no comando.');const answer=(await ask(`Versão atual ${pkg.version}. Digite 1 para correção, 2 para melhoria ou 3 para grande [1]: `)).trim()||'1';type={'1':'correcao','2':'melhoria','3':'grande'}[answer];if(!type)stop('Opção de versão inválida.');}
  version=nextVersion(pkg.version,type);
  if(git(['tag','--list',`v${version}`],'Não consegui consultar as etiquetas de versão.'))stop(`A versão ${version} já existe.`);
  phase='novidades';const news=await readNews(cwd,options.novidades);
  if(!news.length&&!options.sim){log('Escreva as novidades, uma por linha. Deixe vazio para terminar.');for(;;){const item=(await ask('Novidade: ')).trim().replace(/^[-*•]\s*/,'');if(!item)break;news.push(item);}}
  if(!news.length)stop('Escreva ao menos uma novidade em NOVIDADES.md ou no arquivo indicado por --novidades.');
  log(`Versão ${version}\n${news.map(item=>`• ${item}`).join('\n')}`);
  if(!options.sim&&((await ask(options.ensaio?'Confirmar o ensaio? Digite s para continuar: ':'Confirmar a publicação? Digite s para continuar: ')).trim().toLowerCase())!=='s')stop('Publicação cancelada: é necessário responder s ou informar --sim explicitamente. Nenhum arquivo de versão foi alterado.');
  snapshots=await snapshotFiles(cwd);
  phase='testes';
  if(!options.semTestes){checked('npm',['run','typecheck','--silent'],'O código tem erros de tipo.',false);checked('npm',['test','--silent'],'Algum teste falhou. Corrija antes de publicar.',false);}else log('Atenção: testes pulados por --sem-testes.');
  phase='geração dos instaladores';
  checked('npm',['version',version,'--no-git-tag-version','--ignore-scripts'],'Não consegui atualizar o número da versão.');
  await saveHistory(cwd,version,news,now);
  checked('npm',['run','pack:win'],'A geração do instalador falhou.',false);
  const installer=`release/GCP-PDF-Instalador-${version}-x64.exe`,portable=`release/GCP-PDF-Portatil-${version}-x64.exe`;
  for(const path of [installer,portable]){if(!existsSync(join(cwd,path)))stop(`O arquivo obrigatório não foi gerado: ${path}`);if((await readFile(join(cwd,path))).byteLength===0)stop(`O arquivo gerado está vazio: ${path}`);}
  const installerBytes=await readFile(join(cwd,installer));if(installerBytes.byteLength===0)stop('O instalador gerado está vazio.');
  const sha=createHash('sha256').update(installerBytes).digest('hex');
  const notes=`## Novidades da versão ${version}\n\n${news.map(item=>`- ${item}`).join('\n')}\n\nSHA-256 GCP-PDF-Instalador-${version}-x64.exe: \`${sha}\`\n`;
  await mkdir(join(cwd,'release'),{recursive:true});await writeFile(join(cwd,'release','novidades.md'),notes);
  // Read by the app's updater through the release links (no GitHub API limit); see src/main/updates.ts.
  const manifest={version,notes:news.map(item=>`- ${item}`).join('\n'),published:now.toISOString(),assetName:`GCP-PDF-Instalador-${version}-x64.exe`,size:installerBytes.byteLength,sha256:sha};
  await writeFile(join(cwd,'release','atualizacao.json'),JSON.stringify(manifest,null,1));
  if(options.ensaio){await restoreFiles(cwd,snapshots);snapshots=undefined;log(`Ensaio concluído. Arquivos de versão restaurados byte a byte; nenhum commit, tag, envio ou publicação foi feito.\n\n${notes}`);return {ok:true,ensaio:true,version};}
  phase='commit';
  // Commit the empty next-version template, avoiding a dirty worktree after publication.
  await writeFile(join(cwd,'NOVIDADES.md'),MODELO);
  const status=checked('git',['status','--porcelain=v1','-z','--untracked-files=all'],'Não consegui consultar as alterações do projeto.',true,false);
  staged=changedPaths(status).filter(canStagePath);
  if(!staged.length)stop('Nenhum arquivo de código ou de versão foi encontrado para o commit.');
  checked('git',['add','-A','--',...staged],'Não consegui preparar os arquivos do lançamento.');
  const actual=checked('git',['diff','--cached','--name-only','-z'],'Não consegui conferir os arquivos preparados.',true,false).split('\0').filter(Boolean);
  if(actual.some(path=>!canStagePath(path)))stop('Um arquivo privado ou fora do escopo apareceu na área de preparação. A publicação foi interrompida.');
  await writeFile(join(cwd,'release','mensagem-commit.txt'),`chore(release): publicar GCP-PDF ${version}\n\n${news.map(item=>`- ${item}`).join('\n')}\n`);
  commitAttempted=true;
  checked('git',['commit','--quiet','-F','release/mensagem-commit.txt'],'Não consegui salvar o commit da versão.');
  committed=true;
  phase='etiqueta da versão';git(['tag','-a',`v${version}`,'-m',`GCP-PDF ${version}`],'Não consegui criar a etiqueta da versão.');
  phase='envio ao GitHub';checked('git',['push','--atomic','origin','main',`v${version}`],'O envio ao GitHub falhou.',false);
  phase='publicação da release';checked('gh',['release','create',`v${version}`,installer,portable,'release/atualizacao.json','--repo',REPOSITORY,'--verify-tag','--title',`GCP-PDF ${version}`,'--notes-file','release/novidades.md'],'A publicação da release no GitHub falhou.',false);
  log(`Versão ${version} publicada: https://github.com/${REPOSITORY}/releases/tag/v${version}`);
  return {ok:true,version,committed:true};
 }catch(error){
  // A failed commit command can have completed its write: inspect HEAD before considering restoration.
  if(commitAttempted&&!committed){const head=run('git',['rev-parse','HEAD']);committed=!head.ok||head.out.trim()!==originalHead;}
  if(committed){
   recovery=[`O commit já foi criado ou sua conclusão não pôde ser confirmada. Os arquivos e a versão foram mantidos.`,`Confira primeiro: git status e git log -1. Não reinicie o publicador para a mesma versão.`];
   if(phase==='etiqueta da versão')recovery.push(`Confira git tag --list v${version}; se ausente, crie: git tag -a v${version} -m "GCP-PDF ${version}".`);
   if(phase==='etiqueta da versão'||phase==='envio ao GitHub')recovery.push(`Depois confira/envie somente este lançamento: git push --atomic origin main v${version}`);
   recovery.push(`Confira se a release já existe: gh release view v${version} --repo ${REPOSITORY}`);
   recovery.push(`Se ela não existir, publique os arquivos já gerados: gh release create v${version} release/GCP-PDF-Instalador-${version}-x64.exe release/GCP-PDF-Portatil-${version}-x64.exe release/atualizacao.json --repo ${REPOSITORY} --verify-tag --title "GCP-PDF ${version}" --notes-file release/novidades.md`);
  }else if(snapshots){
   try{await restoreFiles(cwd,snapshots);if(staged.length){const unstaged=run('git',['restore','--staged','--',...staged]);if(!unstaged.ok)recovery.push('Os arquivos de versão foram restaurados, mas confira a área de preparação com git status antes de continuar.');}}
   catch(restoreError){recovery.push(`Não consegui concluir a restauração dos arquivos: ${restoreError.message}. Confira git status antes de continuar.`);}
  }
  log(`\nPublicação interrompida na etapa "${phase}": ${error.message}\n${recovery.join('\n')}`);
  return {ok:false,version,phase,committed,error:error.message,recovery};
 }
}
async function cli() {
 const lines=stdin.isTTY?null:await new Promise(resolveLines=>{let text='';stdin.setEncoding('utf8');stdin.on('data',data=>text+=data);stdin.on('end',()=>resolveLines(text.split(/\r?\n/)));});
 if(lines&&!lines.some(line=>line.trim())){console.error('Entrada encerrada sem confirmação. Nada foi alterado. Use .\\Publicar-GCP-PDF.cmd para responder no terminal ou .\\Publicar-GCP-PDF.cmd correcao --sim para uma publicação explicitamente autorizada.');process.exitCode=1;return;}
 const reader=stdin.isTTY?createInterface({input:stdin,output:stdout}):null;
 const ask=async prompt=>{if(reader)return reader.question(prompt);const answer=lines.shift();if(answer===undefined)stop('Entrada encerrada antes da confirmação. Nada será publicado. Use o helper .cmd e responda s, ou informe --sim explicitamente.');console.log(prompt+answer);return answer;};
 try{const result=await runPublication({ask});if(!result.ok)process.exitCode=1;}finally{reader?.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.includes('--help')||process.argv.includes('-h')||process.argv.includes('--sim')||absorbedPublicationFlags().length){const result=await runPublication();if(!result.ok)process.exitCode=1;}else await cli();
}
