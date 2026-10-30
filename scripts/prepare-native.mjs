import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmod,copyFile,cp,mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Same upstream version as the Windows binary shipped in 0.3.7. Hashes are
// pinned from the upstream release assets, never learned from the download.
const targets={
  'linux-x64':{name:'pdfcraft-cli-0.15.0-linux-x86_64.tar.gz',sha256:'a5705977e616852929eb08e7ba6de1e0781289fcc52dab1356215ae644d5973d'},
  'darwin-x64':{name:'pdfcraft-cli-0.15.0-macos-universal.zip',sha256:'0304db20f3597e4e9ad3044d67f79cb89bdad49833c6ad7a60c0d0d6a7afaa50'},
  'darwin-arm64':{name:'pdfcraft-cli-0.15.0-macos-universal.zip',sha256:'0304db20f3597e4e9ad3044d67f79cb89bdad49833c6ad7a60c0d0d6a7afaa50'},
};
if(process.platform==='win32'){
  execFileSync(resolve('assets/pdfcraft/pdfcraft-cli.exe'),['--version'],{stdio:'inherit'});
}else{
  const target=targets[`${process.platform}-${process.arch}`];
  if(!target)throw new Error(`Motor não configurado para ${process.platform}-${process.arch}`);
  const root=await mkdtemp(join(tmpdir(),'gcp-native-'));
  try{
    const response=await fetch(`https://github.com/storytold/pdfcraft/releases/download/v0.15.0/${target.name}`,{signal:AbortSignal.timeout(180_000)});
    if(!response.ok)throw new Error(`Download do motor: HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(createHash('sha256').update(bytes).digest('hex')!==target.sha256)throw new Error('SHA-256 do motor não confere.');
    const archive=join(root,target.name),extracted=join(root,'extracted');
    await writeFile(archive,bytes);await mkdir(extracted);
    execFileSync(target.name.endsWith('.zip')?'unzip':'tar',target.name.endsWith('.zip')?['-q',archive,'-d',extracted]:['-xzf',archive,'-C',extracted],{stdio:'inherit'});
    async function find(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory()){const found=await find(file);if(found)return found;}else if(entry.name==='pdfcraft-cli')return file;}}
    const executable=await find(extracted);
    if(!executable)throw new Error('O arquivo oficial não contém pdfcraft-cli.');
    const destination=resolve('assets/pdfcraft/pdfcraft-cli');
    await copyFile(executable,destination);await chmod(destination,0o755);
    execFileSync(destination,['--version'],{stdio:'inherit'});
    // Preserve the release's legal notices alongside the native binary.
    const folder=join(executable,'..');
    for(const name of await readdir(folder))if(/^(LICENSE|NOTICE|OFL|ATTRIBUTION)/.test(name))await cp(join(folder,name),resolve('assets/pdfcraft',name),{recursive:true});
    console.log(`Motor nativo conferido: ${target.name} (${target.sha256})`);
  }finally{await rm(root,{recursive:true,force:true});}
}
