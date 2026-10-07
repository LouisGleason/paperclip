// Keep public-package lifecycle code off the verification host. Resolve and
// cache the public npm graph without scripts, then execute it offline.
export const GROK_PUBLIC_INSTALL_IMAGE =
  'node:24-trixie@sha256:be40f6a87b9b22215ddb20da0a2320a5c6d583fe3ee3b0024d9fa4f05b40c8fd';
// Complete the scripts-disabled install without resolving the graph again.
export const GROK_PUBLIC_INSTALL_LIFECYCLE = [
  'npm', 'rebuild', '--offline', '--ignore-scripts=false', '--dangerously-allow-all-scripts',
];

// Only the hosted Mac deferred lifecycle uses this policy. The scripts-disabled
// download and later loopback startup remain separate phases. Fail closed if
// sandbox-exec is unavailable; npm's offline flag alone is not OS isolation.
export function macPublicInstallLifecyclePolicy({ ownedRoot, npmRoot }) {
  for (const path of [ownedRoot, npmRoot]) {
    if (typeof path !== 'string' || !path.startsWith('/') || path === '/' || path.split('/').includes('..') ||
      /[\n\r\0]/.test(path)) throw new Error('Lifecycle sandbox requires absolute owned/runtime paths');
  }
  const owned = JSON.stringify(ownedRoot), npm = JSON.stringify(npmRoot);
  return `(version 1)
(deny default)
(deny network*)
(allow process-exec)
(allow process-fork)
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read-data (subpath ${owned}) (subpath ${npm})
  (subpath "/usr") (subpath "/bin") (subpath "/System") (subpath "/Library/Apple")
  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath ${owned}) (literal "/dev/null"))
`;
}

export function grokConsumerDockerArgs({ assets, consumer, cache, command, uid, gid, download = false, prerequisite, temporarySizeMb = 256, runtimeSmoke = false, browserNetwork, containerName }) {
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) {
    throw new Error('Public-install verification requires an unprivileged host user');
  }
  if (!Number.isSafeInteger(temporarySizeMb) || temporarySizeMb < 256 || temporarySizeMb > 2048) throw new Error('Invalid bounded public-install temporary size');
  if (runtimeSmoke && (download || uid !== 1000 || gid !== 1000)) throw new Error('Runtime smoke requires the pinned unprivileged node user and an installed graph');
  if (containerName && (!runtimeSmoke || !/^paperclip-public-install-[a-z0-9-]+$/.test(containerName))) throw new Error('Runtime smoke requires its owned container');
  if (browserNetwork && (!runtimeSmoke || !containerName ||
      !/^paperclip-public-install-[a-z0-9-]+$/.test(browserNetwork))) throw new Error('Browser smoke requires its owned network and container');
  return [
    'run', '--rm', '--platform', 'linux/amd64',
    '--user', `${uid}:${gid}`, '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '256', '--memory', '3g',
    '--network', browserNetwork ?? (download ? 'bridge' : 'none'),
    ...(containerName ? ['--name', containerName] : []),
    ...(browserNetwork ? ['--detach', '--publish', '127.0.0.1::3100'] : []),
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${temporarySizeMb}m,mode=1777`,
    '--env', 'HOME=/tmp', '--env', 'npm_config_cache=/cache',
    '--env', 'npm_config_nodedir=/usr/local',
    '--env', 'npm_config_audit=false', '--env', 'npm_config_fund=false',
    '--env', `npm_config_ignore_scripts=${download ? 'true' : 'false'}`,
    ...(runtimeSmoke ? ['--env', 'PAPERCLIP_OPEN_ON_LISTEN=false', '--env', 'PAPERCLIP_TELEMETRY_DISABLED=1', '--env', 'PAPERCLIP_UPDATE_CHECK=0'] : []),
    '--mount', `type=bind,src=${assets},dst=/packages,readonly`,
    '--mount', `type=bind,src=${consumer},dst=/consumer${runtimeSmoke ? ',readonly' : ''}`,
    '--mount', `type=bind,src=${cache},dst=/cache`,
    ...(prerequisite ? ['--mount', `type=bind,src=${prerequisite},dst=/opt/paperclip/providers/grok/1.0.13/grok,readonly`] : []),
    '--workdir', '/consumer', GROK_PUBLIC_INSTALL_IMAGE, ...command,
  ];
}
