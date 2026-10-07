import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [sourceDirectory, originalDirectory, evidenceDirectory] = process.argv.slice(2);
const w=fs.realpathSync(sourceDirectory), prior=fs.realpathSync(originalDirectory), r=path.resolve(evidenceDirectory);
assert.equal(process.platform,'darwin');assert.equal(process.arch,'x64');
const source='06a3d9739f402baa7f8be7aaa29dda6db7354bfb';
const receiptPin='60a7f44bf2c60ae8be54cd19ec4244e044ac0bee315d93fbf5ac8f86ea8377c0';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(hash(path.join(prior,'receipt.json')),receiptPin);
const old=JSON.parse(fs.readFileSync(path.join(prior,'receipt.json'),'utf8'));
assert.equal(old.sourceRevision,source);assert.equal(old.orchestrationRevision,'f88624c7f749adb1255186734a2a0d7386e9ad0c');
assert.equal(old.target,'darwin-x64');assert.equal(old.nativeHardware.rosetta,false);
assert.equal(old.nativeHardware.nodeArch,'x64');assert.equal(old.nativeHardware.uname,'x86_64');
assert.equal(old.providerCalls,0);assert.equal(old.providerCredentials,false);
assert.equal(old.archives.length,18);
const completed=new Set();
for(const s of old.steps.filter(x=>x.status==='passed')) {
 assert.equal(s.exitCode,0);assert.equal(s.errorCode,null);assert.equal(hash(path.join(prior,s.label+'.log')),s.logSha256);completed.add(s.label);
}
for(const s of ['normal-workspace-build','normal-standalone-public-build','normal-public-npm-install','verify-normal-native-daemon'])assert.ok(completed.has(s));
fs.mkdirSync(r,{recursive:true});const home=path.join(r,'home');fs.mkdirSync(home);
const env={HOME:home,PATH:process.env.PATH,LANG:'en_US.UTF-8',CI:'true',PAPERCLIP_TELEMETRY_ENABLED:'false',PAPERCLIP_UI_DEV_MIDDLEWARE:'false',PAPERCLIP_DISABLE_PLUGIN_AUTOBUILD:'1',npm_config_audit:'false',npm_config_fund:'false',npm_config_foreground_scripts:'true',npm_config_cache:path.join(r,'npm-cache')};
const orchestration=process.env.PI_QUALIFICATION_ORCHESTRATION_SHA;
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
const query=(cmd,args,cwd=w)=>cp.execFileSync(cmd,args,{cwd,env,encoding:'utf8'}).trim();
const receipt={schema:'paperclip.pi.native-macos-continuation.v1',status:'running',sourceRevision:source,orchestrationRevision:orchestration,target:'darwin-x64',providerCredentials:false,providerCalls:0,automaticRetries:0,steps:[],archives:[],startedAt:new Date().toISOString(),buildEvidence:{run:37694650556,artifactId:11517098137,receiptSha256:receiptPin,originalStatus:old.status,completedSteps:[...completed],reason:'Continue interrupted Pi setup from verified original packages; preserve cancelled attempt'},lockSha256:old.lockSha256,releaseVersion:old.releaseVersion};
const save=()=>fs.writeFileSync(path.join(r,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const progress=x=>fs.writeSync(process.stdout.fd,JSON.stringify(x)+'\n');
function run(label,command,args,cwd,timeout) {
 const p=path.join(r,label+'.log'),fd=fs.openSync(p,'wx'),s={label,status:'running',startedAt:new Date().toISOString()};receipt.steps.push(s);save();progress(s);let x;
 try{x=cp.spawnSync(command,args,{cwd,env,stdio:['ignore',fd,fd],timeout,killSignal:'SIGKILL'});}finally{fs.closeSync(fd);}
 Object.assign(s,{status:x.status===0&&!x.error?'passed':'failed',exitCode:x.status,errorCode:x.error?.code??null,logSha256:hash(p),finishedAt:new Date().toISOString()});save();progress(s);assert.equal(s.status,'passed',label);
}
function graph(root,label) {
 const entries=[],real=fs.realpathSync(root);
 function visit(dir){for(const name of fs.readdirSync(dir).sort()){
  const p=path.join(dir,name),rel=path.relative(root,p),st=fs.lstatSync(p);
  if(st.isSymbolicLink()){const resolved=fs.realpathSync(p);assert.ok(resolved===real||resolved.startsWith(real+path.sep));entries.push({path:rel,symlink:fs.readlinkSync(p)});}
  else if(st.isDirectory())visit(p);else if(st.isFile())entries.push({path:rel,bytes:st.size,sha256:hash(p)});else assert.fail(rel);
 }}visit(root);const p=path.join(r,label+'.json');fs.writeFileSync(p,JSON.stringify({root:real,entries},null,2)+'\n');return{entries:entries.length,sha256:hash(p)};
}
try{
 assert.equal(query('git',['rev-parse','HEAD']),source);assert.equal(query('git',['status','--porcelain']),'');assert.equal(query('uname',['-m']),'x86_64');
 const translated=cp.spawnSync('sysctl',['-n','sysctl.proc_translated'],{encoding:'utf8'});assert.notEqual(translated.stdout.trim(),'1');
 receipt.nativeHardware={uname:'x86_64',node:process.version,nodeArch:process.arch,rosetta:false,osVersion:query('sw_vers',['-productVersion'])};assert.equal(process.version,'v24.21.0');
 fs.cpSync(prior,path.join(r,'original-build'),{recursive:true});fs.mkdirSync(path.join(r,'archives'));
 for(const a of old.archives){const p=path.resolve(prior,a.path);assert.ok(p.startsWith(path.join(prior,'archives')+path.sep));assert.equal(hash(p),a.sha256);fs.copyFileSync(p,path.join(r,a.path));receipt.archives.push(a);}save();
 const consumer=path.join(r,'consumer');fs.mkdirSync(consumer);fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('normal-public-npm-install','npm',['install','--omit=dev',...receipt.archives.map(a=>path.join(r,a.path))],consumer,1200000);
 const lockPath=path.join(consumer,'package-lock.json'),lock=fs.readFileSync(lockPath);receipt.consumerLockSha256=hash(lockPath);fs.copyFileSync(lockPath,path.join(r,'consumer-package-lock.json'));
 for(const a of receipt.archives)assert.equal(JSON.parse(fs.readFileSync(path.join(consumer,'node_modules',a.name,'package.json'))).version,receipt.releaseVersion);
 const server=path.join(consumer,'node_modules/@paperclipai/server'),cli=path.join(consumer,'node_modules/paperclipai/dist/index.js'),daemon=path.join(server,'dist/vendor/paperclip-runner/bin/paperclip-runnerd');assert.equal(hash(daemon),old.daemonSha256);
 run('verify-normal-native-daemon','codesign',['--verify','--strict',daemon],consumer,60000);receipt.binaryDescription=query('file',[daemon],consumer);assert.ok(receipt.binaryDescription.includes('Mach-O 64-bit executable x86_64'));receipt.daemonSha256=hash(daemon);
 receipt.beforePiGraph=graph(path.join(consumer,'node_modules'),'installed-graph-before-pi');save();
 run('normal-pi-runtime-setup',process.execPath,[cli,'runtime','setup','pi'],consumer,300000);
 const setup=JSON.parse(fs.readFileSync(path.join(r,'normal-pi-runtime-setup.log'),'utf8').trim());assert.equal(setup.status,'installed_verified');assert.equal(setup.target,'darwin-x64');assert.deepEqual(fs.readFileSync(lockPath),lock);
 const {verifyPiInstallation}=await import(pathToFileURL(path.join(server,'dist/vendor/paperclip-runner/drivers/acpx/pi-installation.js')));
 const {QUALIFIED_ACPX_PROFILES}=await import(pathToFileURL(path.join(server,'dist/vendor/paperclip-runner/drivers/acpx/qualified-profiles.js')));
 assert.equal(QUALIFIED_ACPX_PROFILES.pi.agentProfileVersion,18);assert.equal(QUALIFIED_ACPX_PROFILES.pi.commandDigest,'sha256:9d3e7d8269f1a0af94616552dfc69671932688b81dbbd5bab9ef356b3a9cbccb');receipt.installation=await verifyPiInstallation(QUALIFIED_ACPX_PROFILES.pi);save();
 receipt.afterPiGraph=graph(path.join(consumer,'node_modules'),'installed-graph-after-pi');save();
 run('public-pi-admission-probe',process.execPath,[path.join(w,'scripts/pi-public-install-probe.mjs'),server],consumer,100000);
 receipt.probe=JSON.parse(fs.readFileSync(path.join(r,'public-pi-admission-probe.log'),'utf8'));assert.equal(receipt.probe.promptCalls,0);assert.equal(receipt.probe.cleanRunnerExit,true);assert.equal(receipt.probe.target,'darwin-x64');assert.equal(hash(daemon),old.daemonSha256);
 receipt.status='passed';receipt.finishedAt=new Date().toISOString();save();progress({status:'passed',target:receipt.target,sourceRevision:source,daemonSha256:receipt.daemonSha256,providerCalls:0});
}catch(e){receipt.status='failed';receipt.error=String(e);receipt.finishedAt=new Date().toISOString();save();progress({status:'failed',error:receipt.error,providerCalls:0});process.exitCode=1;}
