/* [INPUT]: Original v3 SVG nodes, elapsed seconds.
 * [OUTPUT]: The original 2026-10-20 poses: typed letters, B recoil, rolling O, eyes, two blinks, blush.
 * [POS]: Original authored animation math; only root lookup and preview controls adapted for embedding.
 * [PROTOCOL]: Keep media/README.md and website/AGENTS.md in sync; do not replace trajectories. */
export function createBrandPose(root) {
  const $ = (selector) => root.querySelector(selector);
  const duration = 6.8;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = (v) => {
    const p = clamp(v);
    return p * p * (3 - 2 * p);
  };
  const smoother = (v) => {
    const p = clamp(v);
    return clamp(p * p * p * (p * (p * 6 - 15) + 10));
  };
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const n = (v) => Number(v.toFixed(4));
  const at = (el, name, value) =>
    el.setAttribute(name, typeof value === 'number' ? n(value) : value);
  const bezier = (p, a, b, c, d) =>
    a.map(
      (v, i) =>
        (1 - p) ** 3 * v + 3 * (1 - p) ** 2 * p * b[i] + 3 * (1 - p) * p * p * c[i] + p ** 3 * d[i],
    );

  function capsule(w, h, radius = Math.min(w, h) / 2) {
    const x = -w / 2,
      y = -h / 2;
    const r = Math.max(0, Math.min(radius, w / 2, h / 2)),
      k = 0.5522847498307936 * r;
    return `M${n(x + r)} ${n(y)}H${n(x + w - r)}C${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}C${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}C${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)}V${n(y + r)}C${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)}Z`;
  }

  const nodes = {
    letters: $('#letters'),
    b: $('#b-rig'),
    shadows: $('#shadows'),
    cheeks: $('#cheeks'),
    glyphs: [$('#letter-p'), $('#letter-a'), $('#letter-l'), $('#b-rig')],
    cursor: $('#cursor'),
    counter: [$('#counter-0'), $('#counter-1')],
    eye: [$('#eye-0'), $('#eye-1')],
    ring: [$('#ring-0'), $('#ring-1')],
    edge: [$('#edge-0'), $('#edge-1')],
    shadow: [$('#shadow-0'), $('#shadow-1')],
    cheek: [$('#cheek-0'), $('#cheek-1')],
    mark: [$('#roll-mark-0'), $('#roll-mark-1')],
    hole: [$('#hole-0'), $('#hole-1')],
  };
  // The upper bowl spits first and supplies the farther O; the lower bowl supplies the nearer O.
  // Eye indices follow the final left/right face, so source order is [lower, upper].
  const anchors = [
    [622, 350],
    [622, 280],
  ];
  const launch = [2.15, 1.58];
  const landing = [2.53, 1.96];
  const landedX = [744, 748];
  const wordX = [767, 932];
  const rollingEnd = [3.08, 2.9];
  const ends = [
    [504, 307],
    [696, 307],
  ];
  const typedAt = [0.12, 0.38, 0.65, 0.92];
  const cursorX = [196, 314, 452, 558, 697];
  const pulse = (t, a, b) => Math.sin(Math.PI * span(t, a, b)) ** 2;

  function bPose(t) {
    const load = pulse(t, 1.15, 1.58) + 0.65 * pulse(t, 1.82, 2.15);
    const recoil = pulse(t, 1.58, 1.84) + 0.65 * pulse(t, 2.15, 2.4);
    return {
      x: -4 * load + 2 * recoil,
      sx: 1 - 0.065 * load + 0.035 * recoil,
      sy: 1 + 0.05 * load - 0.025 * recoil,
      angle: -1.5 * load + 1.2 * recoil,
    };
  }
  function bowlScale(t, i) {
    return 1 + 0.14 * pulse(t, launch[i] - 0.3, launch[i]);
  }

  function blinkAt(t, start, delay = 0) {
    const age = t - start - delay;
    if (age < 0 || age > 0.28) return 0;
    if (age < 0.095) return ease(age / 0.095);
    if (age < 0.115) return 1;
    return 1 - smoother((age - 0.115) / 0.165);
  }

  function eyePose(t, i) {
    const flight = span(t, launch[i], landing[i]);
    const rolling = span(t, landing[i], rollingEnd[i]);
    const morph = smoother(span(t, 3.38, 4.24));
    let xy = [...anchors[i]],
      w = 64,
      h = 50,
      iw = 42,
      ih = 28,
      rotation = 0;
    if (t < launch[i]) {
      const b = bPose(t),
        size = bowlScale(t, i),
        angle = (b.angle * Math.PI) / 180;
      const dy = (anchors[i][1] - 316) * b.sy;
      xy = [622 + b.x - dy * Math.sin(angle), 316 + dy * Math.cos(angle)];
      w *= b.sx * size;
      h *= b.sy * size;
      iw *= b.sx * size;
      ih *= b.sy * size;
      rotation = b.angle;
    } else {
      const grow = smoother(flight);
      w = lerp(64, 144, grow);
      h = lerp(50, 144, grow);
      iw = lerp(42, 78, grow);
      ih = lerp(28, 78, grow);
      const initialRollSpeed = (2 * (wordX[i] - landedX[i])) / (rollingEnd[i] - landing[i]);
      const controlX = landedX[i] - (initialRollSpeed * (landing[i] - launch[i])) / 3;
      xy = bezier(
        flight,
        anchors[i],
        i ? [670, 260] : [698, 344],
        [controlX, i ? 288 : 285],
        [landedX[i], 316],
      );
      if (t >= landing[i]) {
        // Constant friction: angular travel follows distance / radius, and speed falls to zero.
        const travelled = (wordX[i] - landedX[i]) * (2 * rolling - rolling * rolling);
        xy[0] = landedX[i] + travelled;
        const age = t - landing[i];
        const bounce =
          7 *
          Math.abs(Math.sin((Math.PI * age) / 0.2)) *
          Math.exp(-age * 9) *
          (1 - smoother(span(age, 0.28, 0.48)));
        xy[1] = 316 - bounce;
      }
      rotation = (((xy[0] - anchors[i][0]) / 72) * 180) / Math.PI;
      const restAngle = (((wordX[i] - anchors[i][0]) / 72) * 180) / Math.PI;
      const aligned = Math.round(restAngle / 180) * 180;
      xy = [lerp(xy[0], ends[i][0], morph), lerp(xy[1], ends[i][1], morph)];
      w = lerp(w, 82, morph);
      h = lerp(h, 222, morph);
      iw *= 1 - morph;
      ih *= 1 - morph;
      rotation = lerp(rotation, aligned, morph);
    }
    const blink = Math.max(blinkAt(t, 4.68, i * 0.018), blinkAt(t, 5.06, i * 0.014));
    h = lerp(h, 14, blink);
    xy[1] += blink * 18;
    return {
      x: xy[0],
      y: xy[1],
      w,
      h,
      iw,
      ih,
      rotation,
      blink,
      morph,
      flight,
      rolling,
      opacity: t < typedAt[3] ? 0 : 1,
    };
  }

  function phaseAt(t) {
    if (t < 1.15) return ['word', '打字'];
    if (t < 1.58) return ['gather', '蓄力'];
    if (t < 3.08) return ['roll', t < 2.53 ? '吐出' : '滚动'];
    if (t < 3.38) return ['name', '停稳'];
    if (t < 4.64) return ['eyes', '双眼'];
    if (t < 5.42) return ['blink', '眨眼'];
    if (t < 5.9) return ['blink', '腮红'];
    return ['blink', '落定'];
  }

  function render(t) {
    t = clamp(t, 0, duration);
    const fade = 1 - smoother(span(t, 3.38, 3.98));
    at(nodes.letters, 'opacity', fade);
    at(nodes.letters, 'transform', `translate(${n(-28 - 12 * (1 - fade))} 0)`);
    nodes.glyphs.forEach((el, i) => at(el, 'opacity', t >= typedAt[i] ? 1 : 0));
    const typed = typedAt.filter((atTime) => t >= atTime).length;
    const cursorVisible = t < 1.28 && (t < 0.92 || Math.floor(t * 5) % 2 === 0);
    at(nodes.cursor, 'x', cursorX[typed]);
    at(nodes.cursor, 'opacity', cursorVisible ? 1 : 0);
    const b = bPose(t);
    at(
      nodes.b,
      'transform',
      `translate(${n(650 + b.x)} 316) rotate(${n(b.angle)}) scale(${n(b.sx)} ${n(b.sy)}) translate(-650 -316)`,
    );
    nodes.counter.forEach((el, i) => {
      const close =
        1 -
        0.65 *
          ease(span(t, launch[i], launch[i] + 0.16)) *
          (1 - ease(span(t, landing[i] + 0.08, landing[i] + 0.26)));
      const size = bowlScale(t, i);
      at(el, 'd', capsule(42 * size * close, 28 * size * close));
      at(el, 'transform', `translate(650 ${anchors[i][1]})`);
    });

    const poses = [eyePose(t, 0), eyePose(t, 1)];
    poses.forEach((p, i) => {
      const transform = `translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.rotation)})`;
      at(nodes.eye[i], 'transform', transform);
      at(nodes.eye[i], 'opacity', p.opacity);
      const outer = capsule(p.w, p.h);
      const inner = capsule(p.iw, p.ih);
      at(nodes.hole[i], 'd', inner);
      at(nodes.ring[i], 'd', outer + inner);
      at(nodes.edge[i], 'd', outer);
      const ground = ease(span(t, launch[i], landing[i])) * (1 - smoother(span(t, 3.38, 3.72)));
      at(nodes.shadow[i], 'd', capsule(92, 6));
      at(nodes.shadow[i], 'opacity', ground * 0.13);
      at(nodes.shadow[i], 'transform', `translate(${n(p.x)} 392)`);
      const glint =
        ease(span(t, launch[i] + 0.08, landing[i])) * (1 - smoother(span(t, 3.35, 3.88)));
      at(nodes.mark[i], 'd', 'M 33.27 -47.51 A 58 58 0 0 1 56.02 -15.01');
      at(nodes.mark[i], 'opacity', glint);
    });
    const blush = smoother(span(t, 5.42, 5.9));
    at(nodes.cheeks, 'opacity', blush);
    nodes.cheek.forEach((el) => at(el, 'r', 23.5 * lerp(0.75, 1, blush)));
    at(nodes.shadows, 'opacity', 1);
    root.dataset.time = t.toFixed(4);
    root.dataset.phase = phaseAt(t)[0];
    root.dataset.blink = Math.max(...poses.map((p) => p.blink)).toFixed(4);
  }
  return { duration, render };
}
