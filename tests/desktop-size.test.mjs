/* [INPUT]: Actual desktop resize callback and native minimum geometry declarations.
 * [OUTPUT]: The native minimum emits a saveable 320px content width; large sizes and transient geometry guards remain intact.
 * [POS]: Pure synthetic resize events, paired with the Rust main-size persistence regression; no native window.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ui/surfaces/desktop/main.js', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src/panel_window.rs', import.meta.url), 'utf8');
function nativeDimension(value) {
  const expression = /^[\d. +]+$/.test(value)
    ? value
    : native.match(new RegExp(`const ${value}: f64 = ([\\d. +]+);`))?.[1];
  assert.ok(expression, `missing native dimension ${value}`);
  return vm.runInNewContext(expression);
}
const minimum = native
  .match(/\.with_min_inner_size\(LogicalSize::new\(([^)]+)\)\)/)[1]
  .split(',')
  .map((value) => nativeDimension(value.trim()));

function fixture(size, overrides = {}) {
  const calls = [],
    timers = new Map();
  let sequence = 0;
  const context = vm.createContext({
    state: { pendingPlacement: null },
    moving: false,
    resizeTimer: 0,
    innerWidth: size[0],
    innerHeight: size[1],
    windowControls: { geometryTransient: () => false },
    window: {
      setTimeout: (fn, delay) => {
        timers.set(++sequence, { fn, delay });
        return sequence;
      },
    },
    clearTimeout: (id) => timers.delete(id),
    call: (op, data) => {
      calls.push(structuredClone({ op, ...data }));
      return Promise.resolve();
    },
    poll: () => {},
    error: assert.fail,
    ...overrides,
  });
  const start = source.indexOf('  function scheduleResize()');
  const end = source.indexOf("  window.addEventListener('resize', scheduleResize)", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return {
    calls,
    resize(width = size[0], height = size[1]) {
      Object.assign(context, { innerWidth: width, innerHeight: height });
      vm.runInContext('scheduleResize()', context);
    },
    flush() {
      assert.equal(timers.size, 1, 'resize saves coalesce into one timer');
      const [id, { fn, delay }] = [...timers][0];
      timers.delete(id);
      assert.equal(delay, 350);
      fn();
    },
  };
}

test('native minimum and larger desktop widths emit compatible content sizes', () => {
  for (const [viewport, content] of [
    [minimum, [320, 340]],
    [
      [minimum[0] + 1, minimum[1]],
      [321, 340],
    ],
    [
      [1920, 1200],
      [1896, 1176],
    ],
    [
      [20024, 20024],
      [20000, 20000],
    ],
  ]) {
    const ui = fixture(viewport);
    ui.resize();
    ui.flush();
    assert.deepEqual(ui.calls, [{ op: 'size', size: content }]);
  }
});

test('desktop resize coalesces and never saves animation, handoff or system geometry', () => {
  const ui = fixture([1920, 1200]);
  ui.resize();
  ui.resize(...minimum);
  ui.flush();
  assert.deepEqual(ui.calls, [{ op: 'size', size: [320, 340] }]);
  for (const overrides of [
    { moving: true },
    { state: { pendingPlacement: 'sidebar' } },
    { windowControls: { geometryTransient: () => true } },
    { state: null },
  ]) {
    const ui = fixture(minimum, overrides);
    ui.resize();
    ui.flush();
    assert.deepEqual(ui.calls, []);
  }
});
