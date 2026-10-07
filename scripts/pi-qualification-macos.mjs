import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [sourceDirectory, evidenceDirectory, expectedArch] = process.argv.slice(2);
const source = '06a3d9739f402baa7f8be7aaa29dda6db7354bfb';
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, expectedArch);
assert.ok(['arm64', 'x64'].includes(expectedArch));
const w = fs.realpathSync(sourceDirectory), r = path.resolve(evidenceDirectory);
fs.mkdirSync(r, {recursive:true});
const home = path.join(r, 'home'); fs.mkdirSync(home, {recursive:true});
const env = {HOME:home, PATH:process.env.PATH, LANG:'en_US.UTF-8', CI:'true',
 PAPERCLIP_TELEMETRY_ENABLED:'false', PAPERCLIP_UI_DEV_MIDDLEWARE:'false', PAPERCLIP_DISABLE_PLUGIN_AUTOBUILD:'1',
 CARGO_HOME:process.env.CARGO_HOME??path.join(process.env.HOME,'.cargo'), RUSTUP_HOME:process.env.RUSTUP_HOME??path.join(process.env.HOME,'.rustup'),
 CARGO_BUILD_JOBS:'2', npm_config_workspace_concurrency:'2', npm_config_audit:'false', npm_config_fund:'false', npm_config_foreground_scripts:'true', npm_config_cache:path.join(r,'npm-cache')};
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const query = (cmd,args,cwd=w) => cp.execFileSync(cmd,args,{cwd,env,encoding:'utf8'}).trim();
const receipt = {schema:'paperclip.pi.native-macos-public-install.v1',sourceRevision:source,
 orchestrationRevision:process.env.PI_QUALIFICATION_ORCHESTRATION_SHA, target:`darwin-${expectedArch}`,
 status:'running', providerCredentials:false, providerCalls:0, automaticRetries:0, steps:[], archives:[], startedAt:new Date().toISOString()};
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env,env);
const save = () => fs.writeFileSync(path.join(r,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
function run(label,command,args,cwd=w,timeout=900000) {
 const logfile=path.join(r,label+'.log'), fd=fs.openSync(logfile,'wx'), step={label,status:'running',startedAt:new Date().toISOString()};
 receipt.steps.push(step);save();console.log(JSON.stringify(step)); let x;
 try{x=cp.spawnSync(command,args,{cwd,env,stdio:['ignore',fd,fd],timeout,killSignal:'SIGKILL'});}finally{fs.closeSync(fd);}
 Object.assign(step,{status:x.status===0&&!x.error?'passed':'failed',exitCode:x.status,errorCode:x.error?.code??null,logSha256:hash(logfile),finishedAt:new Date().toISOString()});
 save();console.log(JSON.stringify(step));assert.equal(step.status,'passed',label);
}
async function auditGraph(root,label) {
 const entries=[];const rootReal=fs.realpathSync(root);
 function visit(dir) {
  for(const name of fs.readdirSync(dir).sort()) {
   const p=path.join(dir,name),rel=path.relative(root,p),st=fs.lstatSync(p);
   if(st.isSymbolicLink()) {const real=fs.realpathSync(p);assert.ok(real===rootReal||real.startsWith(rootReal+path.sep),`External link: ${rel}`);entries.push({path:rel,symlink:fs.readlinkSync(p)});}
   else if(st.isDirectory())visit(p);
   else if(st.isFile())entries.push({path:rel,bytes:st.size,sha256:hash(p)});
   else assert.fail(`Unexpected graph entry: ${rel}`);
  }
 }
 visit(root);const target=path.join(r,label+'.json');fs.writeFileSync(target,JSON.stringify({root:rootReal,entries},null,2)+'\n');
 return {entries:entries.length,sha256:hash(target)};
}
try {
 assert.equal(query('git',['rev-parse','HEAD']),source);assert.equal(query('git',['status','--porcelain']),'');
 assert.equal(query('uname',['-m']),expectedArch==='arm64'?'arm64':'x86_64');
 const translated=cp.spawnSync('sysctl',['-n','sysctl.proc_translated'],{encoding:'utf8'});assert.notEqual(translated.stdout.trim(),'1');
 receipt.nativeHardware={uname:query('uname',['-m']),node:process.version,nodeArch:process.arch,rosetta:false,osVersion:query('sw_vers',['-productVersion'])};save();
 run('resolve-workspace-dependencies','pnpm',['install','--resolution-only','--ignore-scripts','--no-frozen-lockfile']);
 receipt.lockSha256=hash(path.join(w,'pnpm-lock.yaml'));save();
 run('install-workspace-build-dependencies','pnpm',['install','--frozen-lockfile','--ignore-scripts']);
 run('normal-workspace-build','pnpm',['build'],w,2700000);
 run('normal-standalone-public-build',process.execPath,[path.join(w,'scripts/build-standalone-public-packages.mjs')],w,1200000);
 run('stage-public-ui','bash',[path.join(w,'scripts/prepare-server-ui-dist.sh')]);
 const {materializePublishManifest,prepareBundledPackage}=await import(pathToFileURL(path.join(w,'scripts/prepare-bundled-package.mjs')));
 const listing=query(process.execPath,[path.join(w,'scripts/release-package-map.mjs'),'list']).split('\n').map(x=>x.split('\t'));
 const packages=new Map(listing.map(([dir,name])=>[name,{dir,manifest:JSON.parse(fs.readFileSync(path.join(w,dir,'package.json')))}]));const needed=new Set();
 function visit(name){if(needed.has(name))return;const item=packages.get(name);assert.ok(item,`Missing public package ${name}`);needed.add(name);for(const[dep,spec]of Object.entries({...item.manifest.dependencies,...item.manifest.optionalDependencies}))if(spec.startsWith('workspace:'))visit(dep);}
 for(const name of ['@paperclipai/server','paperclipai','@paperclipai/plugin-sdk','@paperclipai/shared'])visit(name);
 const archives=path.join(r,'archives');fs.mkdirSync(archives);const version='0.0.0-pi-qual.06a3d9739';receipt.releaseVersion=version;
 for(const[index,name]of[...needed].entries()) {
  const {dir,manifest}=packages.get(name),stage=path.join(r,'source-'+index),target=path.join(r,'package-'+index);fs.mkdirSync(stage);
  for(const file of manifest.files??['dist']) {
   const skills=file==='skills'&&['server','packages/adapters/claude-local','packages/adapters/codex-local'].includes(dir);
   if(file==='skills'&&!skills&&!fs.existsSync(path.join(w,dir,file)))continue;
   fs.cpSync(skills?path.join(w,'skills'):path.join(w,dir,file),path.join(stage,file),{recursive:true});
  }
  const m={...manifest,version};fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(m));
  if((manifest.bundleDependencies??manifest.bundledDependencies??[]).length)prepareBundledPackage(stage,target,{sourceRoot:w});
  else{fs.cpSync(stage,target,{recursive:true});fs.writeFileSync(path.join(target,'package.json'),JSON.stringify(materializePublishManifest(m)));}
  const previous=new Set(fs.readdirSync(archives));run('pack-'+index,'npm',['pack','--ignore-scripts','--pack-destination',archives],target);
  const files=fs.readdirSync(archives).filter(x=>x.endsWith('.tgz')&&!previous.has(x));assert.equal(files.length,1);const archive=path.join(archives,files[0]);receipt.archives.push({name,path:path.relative(r,archive),sha256:hash(archive)});save();
  fs.rmSync(stage,{recursive:true});fs.rmSync(target,{recursive:true});
 }
 const consumer=path.join(r,'consumer');fs.mkdirSync(consumer);fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('normal-public-npm-install','npm',['install','--omit=dev',...receipt.archives.map(x=>path.join(r,x.path))],consumer,1200000);
 const lockPath=path.join(consumer,'package-lock.json'),lock=fs.readFileSync(lockPath);receipt.consumerLockSha256=hash(lockPath);
 for(const name of needed)assert.equal(JSON.parse(fs.readFileSync(path.join(consumer,'node_modules',name,'package.json'))).version,version);
 const server=path.join(consumer,'node_modules/@paperclipai/server'),cli=path.join(consumer,'node_modules/paperclipai/dist/index.js'),daemon=path.join(server,'dist/vendor/paperclip-runner/bin/paperclip-runnerd');
 const built=path.join(w,'server/dist/vendor/paperclip-runner/bin/paperclip-runnerd');assert.equal(hash(daemon),hash(built));
 run('verify-normal-native-daemon','codesign',['--verify','--strict',daemon],consumer);
 const binaryDescription=query('file',[daemon],consumer);assert.ok(binaryDescription.includes(expectedArch==='arm64'?'arm64':'x86_64'));receipt.binaryDescription=binaryDescription;receipt.daemonSha256=hash(daemon);
 receipt.beforePiGraph=await auditGraph(path.join(consumer,'node_modules'),'installed-graph-before-pi');save();
 run('normal-pi-runtime-setup',process.execPath,[cli,'runtime','setup','pi'],consumer,300000);
 const setup=JSON.parse(fs.readFileSync(path.join(r,'normal-pi-runtime-setup.log'),'utf8').trim());assert.equal(setup.status,'installed_verified');assert.equal(setup.target,`darwin-${expectedArch}`);assert.deepEqual(fs.readFileSync(lockPath),lock);
 const {verifyPiInstallation}=await import(pathToFileURL(path.join(server,'dist/vendor/paperclip-runner/drivers/acpx/pi-installation.js')));
 const {QUALIFIED_ACPX_PROFILES}=await import(pathToFileURL(path.join(server,'dist/vendor/paperclip-runner/drivers/acpx/qualified-profiles.js')));
 assert.equal(QUALIFIED_ACPX_PROFILES.pi.agentProfileVersion,18);assert.equal(QUALIFIED_ACPX_PROFILES.pi.commandDigest,'sha256:9d3e7d8269f1a0af94616552dfc69671932688b81dbbd5bab9ef356b3a9cbccb');
 receipt.installation=await verifyPiInstallation(QUALIFIED_ACPX_PROFILES.pi);save();
 receipt.afterPiGraph=await auditGraph(path.join(consumer,'node_modules'),'installed-graph-after-pi');save();
 run('public-pi-admission-probe',process.execPath,[path.join(w,'scripts/pi-public-install-probe.mjs'),server],consumer,100000);
 receipt.probe=JSON.parse(fs.readFileSync(path.join(r,'public-pi-admission-probe.log'),'utf8').trim());assert.equal(receipt.probe.promptCalls,0);assert.equal(receipt.probe.cleanRunnerExit,true);assert.equal(receipt.probe.target,`darwin-${expectedArch}`);assert.equal(hash(daemon),receipt.daemonSha256);
 receipt.status='passed';receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:receipt.status,target:receipt.target,sourceRevision:source,daemonSha256:receipt.daemonSha256,providerCalls:0,normalNpmLifecycle:true}));
} catch(e) {receipt.status='failed';receipt.error=String(e);receipt.finishedAt=new Date().toISOString();save();console.error(JSON.stringify({status:'failed',target:receipt.target,error:receipt.error,providerCalls:0}));process.exitCode=1;}
