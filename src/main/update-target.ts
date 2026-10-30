/** Select only installers for the running OS/CPU; Windows manifests stay compatible. */
export function installerPattern(platform:string,arch:string):RegExp {
 if(platform==='win32'&&arch==='x64')return /^GCP-PDF-Instalador-[\w.-]+-x64\.exe$/i;
 if(platform==='darwin'&&['x64','arm64'].includes(arch))return new RegExp(`^GCP-PDF-[\\w.-]+-macOS-${arch}\\.dmg$`,'i');
 if(platform==='linux'&&arch==='x64')return /^GCP-PDF-[\w.-]+-linux-x86_64\.AppImage$/i;
 throw new Error(`Atualizações indisponíveis para ${platform}/${arch}.`);
}
