// Creates (once) the private key that signs the distributed Android APK and points android/signing.properties
// at it. An existing key is always kept: the same key is what lets phones install updates over the app.
//
//   node scripts/android-signing.mjs [folder]     (default: ~/.cache/gcp-pdf-toolchains/android-signing)
//
// The password is random, stored only next to the key, and never printed. Back the folder up privately and
// never publish it; the APK itself carries only the public certificate.
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';

const folder = resolve(process.argv[2] ?? join(homedir(), '.cache/gcp-pdf-toolchains/android-signing'));
const keystore = join(folder, 'gcp-pdf-release.jks'), secrets = join(folder, 'signing.properties');
const javaHome = process.env.JAVA_HOME ?? join(homedir(), '.cache/gcp-pdf-toolchains/jdk-21');
const keytool = join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
await mkdir(folder, {recursive: true, mode: 0o700});
await chmod(folder, 0o700);
if (!existsSync(keystore)) {
  const password = randomBytes(24).toString('base64url');
  execFileSync(keytool, ['-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-alias', 'gcp-pdf', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
    '-dname', 'CN=Bruno Albertini, O=Gestão Cultural Pro, C=BR', '-storepass:env', 'GCP_SIGNING_PASSWORD', '-keypass:env', 'GCP_SIGNING_PASSWORD'],
    {stdio: ['ignore', 'ignore', 'inherit'], env: {...process.env, GCP_SIGNING_PASSWORD: password}});
  await writeFile(secrets, `storeFile=${keystore}\nstorePassword=${password}\nkeyAlias=gcp-pdf\nkeyPassword=${password}\n`, {mode: 0o600, flag: 'wx'});
  console.log(`Chave criada em ${folder}. Faça um backup privado desta pasta.`);
} else console.log(`Chave existente preservada em ${folder}.`);
await chmod(keystore, 0o600);
// android/signing.properties (ignored by Git) is what the Gradle build reads.
await writeFile('android/signing.properties', await readFile(secrets, 'utf8'), {mode: 0o600});
const password = /storePassword=(.*)/.exec(await readFile(secrets, 'utf8'))?.[1] ?? '';
const listing = execFileSync(keytool, ['-list', '-v', '-keystore', keystore, '-storepass:env', 'GCP_SIGNING_PASSWORD'], {encoding: 'utf8', env: {...process.env, GCP_SIGNING_PASSWORD: password}});
console.log('Certificado SHA-256:', /SHA256:\s*([0-9A-F:]+)/.exec(listing)?.[1] ?? '(não lido)');
