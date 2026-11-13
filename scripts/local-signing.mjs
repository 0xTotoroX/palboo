/* [INPUT]: Valid local code-signing identities and the installed Palboo signature.
 * [OUTPUT]: A stable local signing plan; an existing signer is never silently replaced.
 * [POS]: Local installer only. Public packages keep their explicit distribution policy.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

export function chooseLocalSigner(list, installed = '') {
  const identities = [...list.matchAll(/\b([A-Fa-f0-9]{40}) "([^"\n]+)"/g)]
    .map(([, hash, name]) => ({ hash, name }))
    .filter(({ name }) =>
      /^(Apple Development|Mac Developer|Developer ID Application): /.test(name),
    );
  const authority = installed.match(/^Authority=(.+)$/m)?.[1];
  const eligible = authority ? identities.filter(({ name }) => name === authority) : identities;
  if (eligible.length === 1) return eligible[0].hash;
  if (authority)
    throw new Error('找不到唯一的原 Palboo 签名证书；保留已安装应用，未更换签名身份。');
  if (eligible.length > 1) throw new Error('本机有多个开发签名身份，请先明确用于 Palboo 的证书。');
  if (identities.length === 0) return '-';
  throw new Error('无法确定本地签名身份。');
}

export function localSigningPlan(app) {
  let installed = '';
  if (existsSync(app)) {
    const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', '-r-', app], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.error || result.status !== 0)
      throw new Error('无法核实已安装 Palboo 的签名，未替换。');
    installed = result.stdout + result.stderr;
  }
  const list = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    identity: chooseLocalSigner(list, installed),
    previousRequirement: /^Authority=/m.test(installed)
      ? installed.match(/^designated => (.+)$/m)?.[1]
      : undefined,
  };
}

export function verifyLocalSigner(app, plan) {
  if (plan.previousRequirement)
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--strict', '-R', `=${plan.previousRequirement}`, app],
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    );
}
