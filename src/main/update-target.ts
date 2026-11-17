/** Select only installers for the running OS/CPU; Windows manifests stay compatible. */
export type LinuxPackaging='appimage'|'deb'|'rpm';
/** How this Linux copy was installed: a .deb or .rpm user is offered that package, not the AppImage. */
export function linuxPackaging(env:NodeJS.ProcessEnv,exists:(path:string)=>boolean):LinuxPackaging {
 if(env.APPIMAGE)return 'appimage';
 if(exists('/etc/debian_version'))return 'deb';
 if(exists('/etc/redhat-release')||exists('/etc/fedora-release')||exists('/etc/SUSE-brand'))return 'rpm';
 return 'appimage';
}
export function installerPattern(platform:string,arch:string,packaging:LinuxPackaging='appimage'):RegExp {
 if(platform==='win32'&&arch==='x64')return /^GCP-PDF-Instalador-[\w.-]+-x64\.exe$/i;
 if(platform==='darwin'&&['x64','arm64'].includes(arch))return new RegExp(`^GCP-PDF-[\\w.-]+-macOS-${arch}\\.dmg$`,'i');
 if(platform==='linux'&&arch==='x64')return packaging==='deb'?/^GCP-PDF-[\w.-]+-linux-amd64\.deb$/i:packaging==='rpm'?/^GCP-PDF-[\w.-]+-linux-x86_64\.rpm$/i:/^GCP-PDF-[\w.-]+-linux-x86_64\.AppImage$/i;
 throw new Error(`Atualizações indisponíveis para ${platform}/${arch}.`);
}
