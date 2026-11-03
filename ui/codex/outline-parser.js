/*
 * [INPUT]: 当前回答的 Markdown DOM 与共享大纲限制。
 * [OUTPUT]: 扫描同一回答的所有正文块，依次回退到正式标题、推断标题和自然段导航，保留原文锚点。
 * [POS]: Codex 大纲的本地解析器；刷新、身份核验和滚动由 outline.js 负责。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import {
  MAX_OUTLINE_ITEMS,
  MAX_OUTLINE_TITLE_LEN,
  MIN_OUTLINE_TITLE_LEN,
  OUTLINE_PSEUDO_HEADING_SELECTOR,
  OUTLINE_PSEUDO_MIN_SCORE,
  OUTLINE_SEMANTIC_HEADING_SELECTOR,
  OUTLINE_TABLE_SELECTOR,
  ROOT_ATTR,
} from '../shared/constants.js';
import { clamp, normalizeText } from '../shared/text.js';

function outlineVisible(node) {
  if (!(node instanceof Element)) return false;
  if (getComputedStyle(node).visibility === 'hidden') return false;
  const rect = node.getBoundingClientRect();
  return Boolean(rect.width > 8 && rect.height > 8);
}

function outlineMarkdownRoots(messageNode) {
  const markdown = "[class*='markdownContent'],[class*='markdown-content'],.markdown,.prose";
  if (messageNode.matches(markdown)) return [messageNode];
  const selector = `${markdown},article`;
  const roots = Array.from(messageNode.querySelectorAll(selector)).filter((node) => {
    if (outlineProtectedSurface(node)) return false;
    const parentRoot = node.parentElement?.closest(selector);
    return !parentRoot || parentRoot === messageNode || !messageNode.contains(parentRoot);
  });
  return roots.length ? roots : [messageNode];
}

function outlineProtectedSurface(node) {
  if (!(node instanceof Element)) return true;
  return Boolean(
    node.closest(
      [
        `[${ROOT_ATTR}="true"]`,
        "[contenteditable='true']",
        'textarea',
        'input',
        'form',
        '.ProseMirror',
        'button',
        '[role="button"]',
        '[hidden]',
        '[aria-hidden="true"]',
      ].join(','),
    ),
  );
}

function outlineInCodeLike(node) {
  if (!(node instanceof Element)) return true;
  return Boolean(
    node.closest('pre, code, kbd, samp, [data-code-block], .cm-editor, .monaco-editor'),
  );
}

function outlineInTableLike(node) {
  if (!(node instanceof Element)) return true;
  return Boolean(node.closest(OUTLINE_TABLE_SELECTOR));
}

function outlineHeadingLevelFromTag(tag) {
  const match = /^h([1-6])$/i.exec(tag || '');
  return match ? Number(match[1]) : 0;
}

function outlineIsMarkerOnlyTitle(text) {
  const value = normalizeText(text);
  if (!value) return true;
  if (/^[一二三四五六七八九十百零]+[、.．)]?$/.test(value)) return true;
  if (/^\d{1,2}[\.、．)]?$/.test(value)) return true;
  if (/^[（(]\d{1,2}[）)]$/.test(value)) return true;
  return /^#{1,6}$/.test(value);
}

function outlineIsNoiseTitle(text) {
  if (!text || outlineIsMarkerOnlyTitle(text)) return true;
  const length = Array.from(text).length;
  if (length < MIN_OUTLINE_TITLE_LEN || length > MAX_OUTLINE_TITLE_LEN) return true;
  if (
    text.length <= 4 &&
    !/[0-9一二三四五六七八九十#：:]/.test(text) &&
    !outlineHasChapterHeading(text)
  )
    return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[\w./~-]+\.(js|ts|json|md|py|sh|log|png|jpg)$/i.test(text)) return true;
  if (/^\$ |^>`|^```/.test(text)) return true;
  if (
    /^(复制|copy|edit|编辑|share|分享|continue|继续|retry|重试|项|实现|位置|范围|标题|跳转|折叠|刷新)$/i.test(
      text,
    )
  )
    return true;
  if (/^[\d\s:./-]+$/.test(text)) return true;
  if (/^\/Users\/|^~\/|^\.\/|^\/Volumes\//.test(text)) return true;
  return /^(OK|PASS|FAIL|true|false|null)$/i.test(text);
}

function outlineHasChapterHeading(text) {
  const value = normalizeText(text);
  if (!value) return false;
  if (
    /^(摘要|简介|概述|概览|前言|背景|目标|现状|问题(?:分析)?|原因(?:分析)?|分析|方案|解决方案|步骤|实施步骤|实现|验证|验证结果|测试|测试结果|结果|结论|最终结论|总结|建议|后续建议|注意(?:事项)?|说明|补充说明|附录|下一步)(?:\s*[：:—-]\s*\S.*)?$/.test(
      value,
    )
  ) {
    return value.length <= 24;
  }
  return (
    /^(abstract|introduction|overview|background|goals?|problems?|causes?|analysis|solutions?|steps?|implementation|verification|tests?|results?|conclusions?|summary|recommendations?|notes?|appendix|next steps?)(?:\s*[:：—-]\s*\S.*)?$/i.test(
      value,
    ) && value.length <= 32
  );
}

function outlineLooksStructuredHeading(text) {
  const value = normalizeText(text);
  if (!value || outlineIsMarkerOnlyTitle(value)) return false;
  if (/^#{1,6}\s+\S/.test(value)) return true;
  if (/^第[一二三四五六七八九十百零\d]+[章节部分步]/.test(value)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\s*\S.*\S/.test(value)) return true;
  if (/^（?[0-9]{1,2}）\s*\S.*\S/.test(value) || /^\([0-9]{1,2}\)\s*\S.*\S/.test(value))
    return true;
  if (/^\d{1,2}[\.、．\)]\s*\S.*\S/.test(value)) return true;
  return outlineHasChapterHeading(value);
}

function outlineScorePseudoHeading(text, levelHint) {
  let score = levelHint ? 20 : 0;
  if (!outlineLooksStructuredHeading(text) && !levelHint) return 0;
  if (/^#{1,6}\s+\S/.test(text)) score += 50;
  if (/^第[一二三四五六七八九十百零\d]+[章节部分步]/.test(text)) score += 30;
  if (/^[一二三四五六七八九十]+[、.．]\s*\S.*\S/.test(text)) score += 28;
  if (/^（?[0-9]{1,2}）\s*\S.*\S/.test(text) || /^\([0-9]{1,2}\)\s*\S.*\S/.test(text)) score += 24;
  if (/^\d{1,2}[\.、．\)]\s*\S.*\S/.test(text)) score += 26;
  if (/[：:]$/.test(text) && text.length <= 18 && text.length >= 4) score += 8;
  if (outlineHasChapterHeading(text)) score += 24;
  if (text.length >= 4 && text.length <= 20) score += 6;
  if (text.length >= 28) score -= 8;
  if (/[。！？]$/.test(text)) score -= 12;
  if (text.split(' ').length > 12) score -= 10;
  return score;
}

function outlineDisplayHeadingTitle(text) {
  const value = normalizeText(text).replace(/^#{1,6}\s+/, '');
  return value.length <= MAX_OUTLINE_TITLE_LEN
    ? value
    : `${value.slice(0, MAX_OUTLINE_TITLE_LEN - 1)}…`;
}

function outlineOwnsOwnLine(node, text) {
  if (!(node instanceof Element)) return false;
  const parent = node.parentElement;
  if (!parent) return true;
  const parentText = normalizeText(parent.innerText || parent.textContent || '');
  if (!parentText || parentText === text) return true;
  return parentText.startsWith(text) && parentText.length <= text.length + 4;
}

function outlineHeadingNumbering(text) {
  const value = normalizeText(text);
  const patterns = [
    [/^([一二三四五六七八九十]+[、.．])\s*(\S.*)$/, 'han'],
    [/^(第[一二三四五六七八九十百零\d]+[章节部分步])\s*(\S.*)$/, 'chapter'],
    [/^((?:（[0-9]{1,2}）|\([0-9]{1,2}\)))\s*(\S.*)$/, 'arabic-parenthesized'],
  ];
  for (const [pattern, key] of patterns) {
    const match = value.match(pattern);
    if (match) return { prefix: match[1], title: match[2], pattern: key };
  }
  const arabic = value.match(/^(\d{1,2}(?:(?:[\.、．\)]\d{1,2})+)?[\.、．\)]?)\s+(\S.*)$/);
  if (!arabic) return { prefix: '', title: value, pattern: '' };
  const segments = arabic[1].match(/\d{1,2}/g)?.length || 1;
  const separators = arabic[1].match(/[\.、．\)]/g)?.join('') || '.';
  return {
    prefix: arabic[1],
    title: arabic[2],
    pattern: `arabic:${separators}:${segments}`,
  };
}

function outlineHeadingCandidate(node, kind) {
  if (
    !(node instanceof Element) ||
    !outlineVisible(node) ||
    outlineProtectedSurface(node) ||
    outlineInCodeLike(node)
  )
    return null;
  if (node.closest(`[${ROOT_ATTR}="true"]`)) return null;

  const text = normalizeText(
    (node instanceof HTMLElement ? node.innerText : node.textContent) || node.textContent || '',
  );
  if (!text || outlineIsMarkerOnlyTitle(text)) return null;
  const displayText = outlineDisplayHeadingTitle(text);
  const numbering = outlineHeadingNumbering(displayText);

  if (kind === 'semantic') {
    const tagLevel = outlineHeadingLevelFromTag(node.tagName);
    const ariaLevel = Number(node.getAttribute('aria-level') || 0);
    return {
      el: node,
      text: displayText,
      level: clamp(tagLevel || ariaLevel || 2, 1, 6),
      numberingPattern: numbering.pattern,
      numberPrefix: numbering.prefix,
      labelText: numbering.title,
      anchorText: text,
      kind,
    };
  }

  if (text.length > MAX_OUTLINE_TITLE_LEN + 8 || outlineIsNoiseTitle(displayText)) return null;
  if (outlineInTableLike(node)) return null;
  const childCount = node.children?.length || 0;
  if (childCount > 3 || node.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,table,pre')) return null;

  if (node.matches('strong,b')) {
    if (!outlineOwnsOwnLine(node, text)) return null;
    const score = outlineScorePseudoHeading(text, 1) + 8;
    if (score < OUTLINE_PSEUDO_MIN_SCORE) return null;
    return {
      el: node,
      text: displayText,
      level: 3,
      numberingPattern: numbering.pattern,
      numberPrefix: numbering.prefix,
      labelText: numbering.title,
      anchorText: text,
      kind,
    };
  }

  const rect = node.getBoundingClientRect();
  if (rect.height > 84 || !outlineLooksStructuredHeading(text)) return null;
  const score = outlineScorePseudoHeading(text, 0);
  if (score < OUTLINE_PSEUDO_MIN_SCORE) return null;
  return {
    el: node,
    text: displayText,
    level: numbering.pattern ? 2 : text.length <= 12 ? 2 : 3,
    numberingPattern: numbering.pattern,
    numberPrefix: numbering.prefix,
    labelText: numbering.title,
    anchorText: text,
    kind,
  };
}

function outlineCollectSemanticHeadings(root) {
  if (!(root instanceof Element)) return [];
  const result = [];
  const nodes = root.querySelectorAll(OUTLINE_SEMANTIC_HEADING_SELECTOR);
  for (const node of nodes) {
    const item = outlineHeadingCandidate(node, 'semantic');
    if (item) result.push(item);
  }
  return result;
}

function outlineCollectPseudoHeadings(root) {
  if (!(root instanceof Element)) return [];
  const result = [];
  const nodes = root.querySelectorAll(OUTLINE_PSEUDO_HEADING_SELECTOR);
  for (const node of nodes) {
    if (node.closest(OUTLINE_SEMANTIC_HEADING_SELECTOR)) continue;
    const item = outlineHeadingCandidate(node, 'pseudo');
    if (item) result.push(item);
  }
  return result;
}

function outlineSortInDocumentOrder(items) {
  return items.slice().sort((left, right) => {
    if (left.el === right.el) return 0;
    const position = left.el.compareDocumentPosition(right.el);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function outlineDedupeItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.level}|${item.text}`;
    if (seen.has(key)) continue;
    const previous = result.at(-1);
    if (
      previous &&
      (previous.text === item.text ||
        previous.el.contains(item.el) ||
        item.el.contains(previous.el))
    ) {
      continue;
    }
    seen.add(key);
    result.push(item);
    if (result.length >= MAX_OUTLINE_ITEMS) break;
  }
  return result;
}

function outlineNormalizeDisplayLevels(items) {
  if (!items.length) return items;
  const minimumLevel = Math.min(...items.map((item) => item.level));
  const numberedLevels = new Map();
  items.forEach((item) => {
    const baseLevel = item.level - minimumLevel;
    if (!item.numberingPattern) {
      item.displayLevel = baseLevel;
      return;
    }
    if (!numberedLevels.has(item.numberingPattern))
      numberedLevels.set(item.numberingPattern, baseLevel);
    item.displayLevel = numberedLevels.get(item.numberingPattern);
  });
  return items;
}

const PARAGRAPH_BLOCK_SELECTOR = 'p,div,ul,ol,table,blockquote,pre,[role="table"]';
const PARAGRAPH_ATOMIC_SELECTOR = 'ul,ol,table,blockquote,pre,[role="table"]';
const MAX_PARAGRAPH_ITEMS = 6;
const PARAGRAPH_GROUP_SIZE = 600;

function outlineParagraphLabel(text, sentenceOnly = true) {
  const value = normalizeText(text).replace(/\s+/g, ' ');
  const sentence =
    (sentenceOnly && value.match(/^(.+?[。！？]|.+?[.!?](?:\s|$))/u)?.[1]?.trim()) || value;
  const characters = Array.from(sentence);
  return characters.length <= MAX_OUTLINE_TITLE_LEN
    ? sentence
    : `${characters.slice(0, MAX_OUTLINE_TITLE_LEN - 1).join('')}…`;
}

function outlineParagraphBlocks(roots) {
  const blocks = [];
  for (const node of roots.flatMap((root) =>
    Array.from(root.querySelectorAll(PARAGRAPH_BLOCK_SELECTOR)),
  )) {
    if (!outlineVisible(node) || outlineProtectedSurface(node)) continue;
    // 列表、引用、表格和代码是完整块；不重复收集其内部段落或包装节点。
    if (node.parentElement?.closest(PARAGRAPH_ATOMIC_SELECTOR)) continue;
    const atomic = node.matches(PARAGRAPH_ATOMIC_SELECTOR);
    if (!atomic && (outlineInCodeLike(node) || node.querySelector(PARAGRAPH_BLOCK_SELECTOR)))
      continue;
    if (node.querySelector('input,textarea,button,[contenteditable="true"]')) continue;
    const text = normalizeText(node.innerText || node.textContent || '');
    if (text.length < 8) continue;
    const previous = blocks.at(-1);
    // 短引导句与随后的列表/表格同组，代码只贡献长度，不成为导航标签。
    if (
      node.matches('pre') ||
      (atomic && previous && !previous.atomic && previous.text.length <= MAX_OUTLINE_TITLE_LEN)
    ) {
      if (previous) {
        previous.weight += text.length;
        previous.content += `\n${text}`;
      }
      continue;
    }
    blocks.push({ el: node, text, content: text, weight: text.length, atomic });
  }
  return blocks;
}

function outlineCollectParagraphs(roots) {
  const blocks = outlineParagraphBlocks(roots);
  if (blocks.length < 2) return [];
  const total = blocks.reduce((sum, block) => sum + block.weight, 0);
  const desired = Math.min(
    MAX_PARAGRAPH_ITEMS,
    blocks.length,
    Math.max(2, Math.ceil(total / PARAGRAPH_GROUP_SIZE)),
  );
  const groups = [];
  let cursor = 0;
  let remainingWeight = total;
  for (let remainingGroups = desired; remainingGroups > 0; remainingGroups -= 1) {
    const group = { ...blocks[cursor++] };
    const groupSize = remainingWeight / remainingGroups;
    // 选择最接近目标长度的自然段边界，并给后续每组至少留一个块。
    while (cursor <= blocks.length - remainingGroups) {
      const block = blocks[cursor];
      if (
        remainingGroups > 1 &&
        Math.abs(group.weight - groupSize) < Math.abs(group.weight + block.weight - groupSize)
      )
        break;
      group.weight += block.weight;
      group.content += `\n${block.content}`;
      cursor += 1;
    }
    groups.push(group);
    remainingWeight -= group.weight;
  }
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    const text = outlineParagraphLabel(group.text);
    if (seen.has(group.content) || outlineIsNoiseTitle(text)) continue;
    seen.add(group.content);
    result.push({
      el: group.el,
      text,
      labelText: text,
      anchorText: group.text,
      kind: 'paragraph',
      level: 2,
      numberPrefix: '',
      numberingPattern: '',
    });
  }
  const counts = new Map();
  for (const item of result) counts.set(item.text, (counts.get(item.text) || 0) + 1);
  const labels = new Set();
  for (const item of result) {
    const base =
      counts.get(item.text) > 1 ? outlineParagraphLabel(item.anchorText, false) : item.text;
    let text = base;
    let occurrence = 2;
    while (labels.has(text)) {
      const suffix = ` (${occurrence++})`;
      text = `${Array.from(base)
        .slice(0, MAX_OUTLINE_TITLE_LEN - suffix.length)
        .join('')}${suffix}`;
    }
    labels.add(text);
    item.text = item.labelText = text;
  }
  return result.length >= 2 ? result : [];
}

function outlineCollectItems(messageNode) {
  if (!(messageNode instanceof Element)) return [];
  const roots = outlineMarkdownRoots(messageNode);
  const semantic = roots.flatMap(outlineCollectSemanticHeadings);
  const headings = semantic.length ? semantic : roots.flatMap(outlineCollectPseudoHeadings);
  const items = headings.length
    ? outlineDedupeItems(outlineSortInDocumentOrder(headings))
    : outlineCollectParagraphs(roots);
  return outlineNormalizeDisplayLevels(items).map((item, anchorIndex) => ({
    ...item,
    anchorIndex,
  }));
}

export { outlineCollectItems };
