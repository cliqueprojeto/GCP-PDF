import test from 'node:test';
import assert from 'node:assert/strict';
import {installerPattern} from '../src/main/update-target';
test('updates select the running OS and CPU without offering Windows installers on Unix',()=>{
 const assets=['GCP-PDF-Instalador-0.3.7-x64.exe','GCP-PDF-Portatil-0.3.7-x64.exe','GCP-PDF-0.3.7-linux-x86_64.AppImage','GCP-PDF-0.3.7-linux-amd64.deb','GCP-PDF-0.3.7-macOS-arm64.dmg','GCP-PDF-0.3.7-macOS-x64.dmg'];
 for(const [platform,arch,expected] of [['win32','x64',0],['linux','x64',2],['darwin','arm64',4],['darwin','x64',5]] as const)assert.deepEqual(assets.filter(a=>installerPattern(platform,arch).test(a)),[assets[expected]]);
 assert.throws(()=>installerPattern('linux','arm64'),/indisponíveis/);
});
