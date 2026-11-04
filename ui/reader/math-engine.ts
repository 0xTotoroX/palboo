/* [INPUT]: Bounded TeX expressions and the consumer's document/shadow root.
 * [OUTPUT]: Untrusted-input KaTeX markup and reference-counted local font styles.
 * [POS]: Lazy renderer; never trusts commands, shares macros or fetches a CDN.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import katex from 'katex';
import css from 'katex/dist/katex.min.css?inline';
const styles = new WeakMap<Node, { node: HTMLStyleElement; users: number }>();
function retain(root: Document | ShadowRoot) {
  let item = styles.get(root);
  if (!item) {
    const node = document.createElement('style');
    node.dataset.readerMath = '';
    node.textContent = css;
    (root instanceof Document ? root.head : root).append(node);
    item = { node, users: 0 };
    styles.set(root, item);
  }
  item.users++;
  return () => {
    if (--item.users === 0) {
      item.node.remove();
      styles.delete(root);
    }
  };
}
export function mathStyles(node: Element) {
  // Font faces belong to the document even when the demo's rules live in a shadow root.
  const releaseDocument = retain(node.ownerDocument);
  const root = node.getRootNode();
  const releaseShadow = root instanceof ShadowRoot ? retain(root) : () => {};
  return () => {
    releaseShadow();
    releaseDocument();
  };
}
export function renderMath(source: string, displayMode: boolean) {
  if (source.length > 10000) throw new Error('math-size');
  return katex.renderToString(source, {
    displayMode,
    output: 'htmlAndMathml',
    trust: false,
    throwOnError: true,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20,
    macros: {},
  });
}
