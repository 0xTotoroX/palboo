/*
 * [INPUT]: GitHub token、固定官方仓库、REST 请求与附件字节。
 * [OUTPUT]: 有界只读重试、分页读取与单次写请求；不自动删除或重试发布。
 * [POS]: 发布工具共用的 GitHub HTTP 边界，不依赖 gh 的隐式清理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { setTimeout as delay } from 'node:timers/promises';

export const repository = '0xTotoroX/palboo';

export function githubClient({ token, fetcher = fetch, sleep = delay } = {}) {
  if (!token) throw new Error('缺少 GitHub token');
  async function request(method, path, body, { optional = false, upload = false } = {}) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./?=&%+-]*$/.test(path) || path.includes('..'))
      throw new Error('无效 GitHub API 路径');
    const url = `https://${upload ? 'uploads' : 'api'}.github.com/repos/${repository}/${path}`;
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response;
      try {
        response = await fetcher(url, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(upload ? 180_000 : 30_000),
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2026-03-10',
            'Content-Type': upload ? 'application/octet-stream' : 'application/json',
            'User-Agent': 'palboo-release',
          },
          body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
        });
        if (optional && response.status === 404) return null;
        if (response.ok) return response.status === 204 ? null : await response.json();
      } catch {
        // 写请求的结果可能已经生效；交给调用方回读，绝不在 HTTP 层重试。
        if (attempt + 1 === attempts) throw new Error(`GitHub ${method} ${path} 响应不确定`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter
        ? /^\d+$/.test(retryAfter)
          ? Number(retryAfter)
          : Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000)
        : 2 ** attempt;
      if (retryable && attempt + 1 < attempts && Number.isFinite(seconds) && seconds <= 30) {
        await sleep(seconds * 1000);
        continue;
      }
      throw new Error(`GitHub ${method} ${path} 失败 (HTTP ${response.status})`);
    }
  }
  async function list(path, field) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const result = await request(
        'GET',
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const rows = field ? result[field] : result;
      if (!Array.isArray(rows)) throw new Error(`GitHub 列表格式错误：${path}`);
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    throw new Error(`GitHub 列表超过分页上限：${path}`);
  }
  return { request, list };
}
