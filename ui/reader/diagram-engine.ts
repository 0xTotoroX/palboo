/* [INPUT]: Validated Mermaid source, resolved reader colors and a cancellation signal.
 * [OUTPUT]: A bounded, inert SVG image; serialized rendering leaves no temporary DOM.
 * [POS]: Lazy local engine; source cannot enable HTML, interactions or resource loading.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import mermaid from 'mermaid';
let queue: Promise<unknown> = Promise.resolve();
let serial = 0;
export function validateDiagram(source: string) {
  if (source.length > 50000) throw new Error('diagram-size');
  // Reject resource/configuration syntax before Mermaid creates any measuring DOM.
  // Encoded CSS/HTML is deliberately unsupported, including escaped style tokens.
  if (
    /^\s*---|%%\s*\{|(?:https?|data|blob|file|javascript|ftp):|\/\/|url\s*\(|@import|["']?\b(?:img|image)["']?\s*:|<\/?[a-z!]|&(?:#|[a-z]+;)|\b(?:classDef|style|linkStyle)\b[\s\S]*\\/im.test(
      source,
    )
  )
    throw new Error('diagram-resource');
}
type Palette = {
  dark: boolean;
  paper: string;
  ink: string;
  muted: string;
  line: string;
  surface: string;
};
function color(node: Element, property: string, fallback: string) {
  const value = getComputedStyle(node).getPropertyValue(property).trim();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function diagramPalette(node: Element, dark: boolean): Palette {
  // Resolve variables through CSS before converting host color()/color-mix() to sRGB.
  const sample = document.createElement('span');
  node.append(sample);
  const read = (variable: string, fallback: string) => {
    sample.style.color = `var(${variable}, ${fallback})`;
    return color(sample, 'color', fallback);
  };
  const palette = {
    dark,
    paper: read('--reader-paper', dark ? '#181818' : '#ffffff'),
    ink: read('--reader-ink', dark ? '#eeeeee' : '#222222'),
    muted: read('--reader-muted', '#777777'),
    line: read('--reader-line', '#999999'),
    surface: read('--reader-hover', dark ? '#303030' : '#f0f0f0'),
  };
  sample.remove();
  return palette;
}
function safeSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (
    doc.querySelector(
      'parsererror, script, foreignObject, image, iframe, object, embed, animate, set',
    )
  )
    throw new Error('diagram-svg');
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        (/^(?:href|xlink:href|src)$/i.test(attr.name) && !attr.value.startsWith('#'))
      )
        node.removeAttribute(attr.name);
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
export function renderDiagram(source: string, palette: Palette, signal: AbortSignal) {
  validateDiagram(source);
  const job = queue.then(async () => {
    signal.throwIfAborted();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      maxTextSize: 50000,
      maxEdges: 500,
      logLevel: 5,
      theme: 'base',
      fontFamily: 'system-ui, sans-serif',
      secure: [
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'htmlLabels',
        'flowchart',
        'theme',
        'themeVariables',
        'fontFamily',
      ],
      themeVariables: {
        darkMode: palette.dark,
        background: palette.paper,
        primaryColor: palette.surface,
        primaryTextColor: palette.ink,
        primaryBorderColor: palette.muted,
        secondaryColor: palette.paper,
        tertiaryColor: palette.surface,
        lineColor: palette.muted,
        textColor: palette.ink,
        mainBkg: palette.surface,
        nodeBorder: palette.muted,
        clusterBkg: palette.paper,
        clusterBorder: palette.line,
        edgeLabelBackground: palette.paper,
        titleColor: palette.ink,
      },
    });
    const container = document.createElement('div');
    container.dataset.readerDiagramMeasure = '';
    Object.assign(container.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: '1200px',
      visibility: 'hidden',
    });
    document.body.append(container);
    try {
      const result = await mermaid.render(`palboo-diagram-${++serial}`, source, container);
      signal.throwIfAborted();
      return safeSvg(result.svg);
    } finally {
      container.remove();
    }
  });
  queue = job.catch(() => {});
  return job;
}
