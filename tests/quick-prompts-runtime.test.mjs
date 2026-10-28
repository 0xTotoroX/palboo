/* [INPUT]: Actual quick-prompt view, runtime guards and composer functions with synthetic targets.
 * [OUTPUT]: Delayed clicks cannot adopt a new target; locked phrases fill/send without answer scanning, preserve drafts and cancel sends after node replacement.
 * [POS]: In-memory regression tests; no host, services, configuration or generated files.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const sources = new Map();

// Parse declarations instead of copying implementations or matching braces in function bodies.
function load(context, path, names) {
  if (!sources.has(path)) {
    const text = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    sources.set(
      path,
      ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
    );
  }
  const source = sources.get(path);
  const declarations = names.map((name) => {
    for (const node of source.statements) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name)
        return node.getText(source).replace(/^export\s+/, '');
      if (ts.isVariableStatement(node)) {
        const value = node.declarationList.declarations.find(
          (item) => item.name.getText(source) === name,
        );
        if (value) return `const ${value.getText(source)};`;
      }
    }
    assert.fail(`${path} no longer declares ${name}; update the fixture to load its real owner`);
  });
  runInContext(declarations.join('\n'), context, { filename: path });
}

function clock() {
  const pending = new Map();
  let sequence = 0;
  return {
    pending,
    setTimeout(callback, delay) {
      pending.set(++sequence, { callback, delay });
      return sequence;
    },
    clearTimeout: (id) => pending.delete(id),
    flush() {
      for (const [id, timer] of [...pending]) {
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

function viewFixture() {
  const timers = clock();
  const calls = [];
  let target = 'composer-a';
  let snapshot = {
    instanceId: 'runtime-a',
    viewToken: 'input-a',
    context: { sessionId: '', paneKey: '', generation: 1 },
    quickPromptToken: 'unchanged-phrases',
    settings: {
      enabled: false,
      quickPromptsEnabled: true,
      quickPromptClickMode: 'direct',
      configurationRevision: 1,
      quickPrompts: [{ label: '继续', prompt: '继续当前方案' }],
    },
  };
  const context = createContext({
    window: { setTimeout: timers.setTimeout },
    clearTimeout: timers.clearTimeout,
    getLocale: () => 'zh-CN',
    tr: (text) => text,
  });
  load(context, 'ui/shared/constants.js', ['PROMPT_CLICK_DELAY_MS']);
  load(context, 'ui/features/next/quick-prompts.js', ['createQuickPrompts']);
  load(context, 'ui/features/quick-prompts.js', ['createQuickPromptsView']);
  const button = Object.assign(new EventTarget(), {
    dataset: { quickPrompt: '0' },
    isConnected: true,
  });
  const root = Object.assign(new EventTarget(), {
    matches: () => true,
    querySelector: () => null,
    querySelectorAll: (selector) =>
      ['[data-quick-prompt]', 'button,input,textarea'].includes(selector) ? [button] : [],
  });
  const view = context.createQuickPromptsView({
    read: () => snapshot,
    reading: {},
    // Like ProjectedContent's latest ref, dispatch sees the current projection.
    command: (kind, data) => calls.push({ kind, ...data, target, viewToken: snapshot.viewToken }),
  });
  view.bind(root);
  return {
    calls,
    timers,
    view,
    click() {
      button.dispatchEvent(Object.assign(new Event('click'), { detail: 1 }));
    },
    replaceInput() {
      target = 'composer-b';
      snapshot = { ...snapshot, viewToken: 'input-b' };
    },
  };
}

test('unchanged quick-prompt target dispatches once after the click delay', () => {
  const fixture = viewFixture();
  fixture.click();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.timers.pending.size, 1);
  fixture.timers.flush();
  assert.deepEqual(fixture.calls, [
    { kind: 'quick-fill', index: 0, submit: true, target: 'composer-a', viewToken: 'input-a' },
  ]);
  fixture.view.clear();
});

test('a delayed quick-prompt click cannot adopt a replacement input with the same empty chat identity', () => {
  const fixture = viewFixture();
  fixture.click();
  assert.equal(fixture.timers.pending.size, 1);
  fixture.replaceInput();
  // Keep the old button mounted: the callback itself must reject its stale intent.
  fixture.timers.flush();
  assert.deepEqual(fixture.calls, []);
  fixture.click();
  fixture.timers.flush();
  assert.deepEqual(fixture.calls, [
    { kind: 'quick-fill', index: 0, submit: true, target: 'composer-b', viewToken: 'input-b' },
  ]);
  fixture.view.clear();
});

function runtimeFixture(draft = '') {
  const timers = clock();
  class TextArea extends EventTarget {
    value = draft;
    isConnected = true;
    focus() {}
    getAttribute() {
      return null;
    }
  }
  class Input extends Event {}
  const composer = new TextArea();
  let activeComposer = composer;
  const root = {};
  let sourceAvailable = true;
  let sendReady = true;
  let inputEvents = 0;
  let sends = 0;
  let unrelatedInputReads = 0;
  const sendAttempts = [];
  const sentTargets = [];
  composer.addEventListener('input', () => inputEvents++);
  const context = createContext({
    IS_POPOUT: false,
    API_KEY: '__companionFloatingPanel',
    INSTANCE_ID: 'runtime-a',
    window: {
      __companionFloatingPanel: { instanceId: 'runtime-a' },
      __palbooModelControl: {
        inputTarget() {
          unrelatedInputReads++;
          throw Error('A locked source must not fall back to the foreground input');
        },
      },
      setTimeout: timers.setTimeout,
    },
    clearTimeout: timers.clearTimeout,
    document: { contains: (target) => target === activeComposer && target.isConnected },
    runtimeState: {
      runtimeActive: true,
      runtimeGeneration: 1,
      scans: 0,
      settings: {
        enabled: false,
        answerOutlineEnabled: false,
        quickPromptsEnabled: true,
        quickPrompts: [{ label: '继续', prompt: '继续当前方案' }],
      },
    },
    contextState: {
      chatBinding: { mode: 'locked', sessionId: 'thread-a' },
      activeContext: {
        generation: 1,
        paneKey: 'pane-a',
        sessionId: 'thread-a',
        assistantMessageId: '',
      },
      lastAssistantHash: '',
    },
    stepwiseState: { stepwiseEpoch: 0, prompts: [], promptContext: null },
    // Only the DOM boundary is synthetic. Identity and answer checks run from source.
    resolveActiveThreadRoot: () => (sourceAvailable ? root : null),
    rootForContext: () => root,
    composerCandidates: () => [activeComposer],
    mainComposerCandidate: () => activeComposer,
    findLatestAssistantMessage: () => ({ text: 'An answer already exists before cold start.' }),
    chatBusy: () => false,
    composerBusy: () => false,
    installStyle() {},
    installFloat() {},
    renderFloat() {},
    pushDiagnostic() {},
    rectSummary: () => ({}),
    tr: (text) => text,
    HTMLElement: TextArea,
    HTMLTextAreaElement: TextArea,
    HTMLInputElement: class {},
    InputEvent: Input,
    Event,
    // The final host send action is synthetic; readiness/identity/retry guards are real.
    submitComposer(target) {
      sendAttempts.push(target);
      if (!sendReady) return false;
      sends++;
      sentTargets.push(target);
      return true;
    },
  });
  load(context, 'ui/shared/constants.js', ['SUBMIT_RETRY_DELAY_MS', 'SUBMIT_RETRY_LIMIT']);
  load(context, 'ui/shared/text.js', ['hashText', 'normalizeText']);
  load(context, 'ui/shared/quick-prompts.js', ['quickPromptToken']);
  load(context, 'ui/codex/runtime/state.js', [
    'isCurrentInstance',
    'isCurrentRuntime',
    'stepwiseEnabled',
    'quickPromptsEnabled',
    'outlineEnabled',
    'runtimeEnabled',
  ]);
  load(context, 'ui/codex/context.js', ['bindingSourceReady', 'contextSnapshot', 'contextMatches']);
  load(context, 'ui/codex/composer.js', [
    'composerRootForContext',
    'composerTargetForContext',
    'composerText',
    'setNativeValue',
    'rawComposerText',
    'submitComposerWhenReady',
  ]);
  load(context, 'ui/codex/next.js', ['quickInputTarget', 'fillComposer']);
  load(context, 'ui/codex/runtime/lifecycle.js', ['scanCurrent']);
  load(context, 'ui/codex/runtime/presentation.js', ['panelCommand']);
  context.exportPanelState = () => ({
    viewToken: 'current-input',
    quickPromptToken: context.quickPromptToken(context.runtimeState.settings),
  });
  context.emitSignal = (name) => {
    if (name === 'verify') context.scanCurrent(1, 0);
  };
  return {
    context,
    composer,
    timers,
    sendAttempts,
    sentTargets,
    counters: () => ({ inputEvents, sends, unrelatedInputReads }),
    setSendReady: (value) => {
      sendReady = value;
    },
    replaceComposer() {
      activeComposer.isConnected = false;
      // A host remount may preserve the text: cancellation must depend on node identity.
      const text = activeComposer.value;
      activeComposer = new TextArea();
      activeComposer.value = text;
      activeComposer.addEventListener('input', () => inputEvents++);
      return activeComposer;
    },
    removeSource: () => {
      sourceAvailable = false;
    },
    command: () => ({
      kind: 'quick-fill',
      instanceId: 'runtime-a',
      ...context.exportPanelState(),
      context: context.contextSnapshot(),
      index: 0,
      submit: false,
    }),
  };
}

for (const waitForSendButton of [false, true]) {
  test(`locked direct quick phrases send to the original node ${waitForSendButton ? 'after a readiness retry' : 'immediately'} without answer scanning`, () => {
    const fixture = runtimeFixture();
    fixture.setSendReady(!waitForSendButton);
    const { context } = fixture;
    assert.equal(
      context.contextMatches(context.contextSnapshot()),
      false,
      'the old answer guard would reject sending',
    );
    const result = context.panelCommand({ ...fixture.command(), submit: true });
    assert.equal(result.ok, true, result.message);
    assert.equal(fixture.composer.value, '继续当前方案');
    if (waitForSendButton) {
      assert.equal(fixture.counters().sends, 0);
      assert.equal(fixture.timers.pending.size, 1);
      fixture.setSendReady(true);
      fixture.timers.flush();
    }
    assert.equal(
      context.contextState.lastAssistantHash,
      '',
      'sending does not require an answer scan',
    );
    assert.deepEqual(fixture.sentTargets, [fixture.composer]);
    assert.deepEqual(fixture.counters(), { inputEvents: 1, sends: 1, unrelatedInputReads: 0 });
    assert.equal(fixture.timers.pending.size, 0);
  });
}

test('locked direct quick phrases cancel a pending send after an identical composer node is replaced', () => {
  const fixture = runtimeFixture();
  fixture.setSendReady(false);
  const command = { ...fixture.command(), submit: true };
  assert.equal(fixture.context.panelCommand(command).ok, true);
  assert.equal(
    fixture.timers.pending.size,
    1,
    'a send must actually be waiting before replacement',
  );
  assert.deepEqual(fixture.sendAttempts, [fixture.composer]);
  const replacement = fixture.replaceComposer();
  assert.notEqual(replacement, fixture.composer);
  assert.equal(replacement.value, '继续当前方案');
  assert.equal(
    fixture.context.contextMatches(command.context, { answer: false }),
    true,
    'the chat remains valid; only the node changed',
  );
  fixture.setSendReady(true);
  fixture.timers.flush();
  assert.deepEqual(fixture.sentTargets, []);
  assert.deepEqual(
    fixture.sendAttempts,
    [fixture.composer],
    'the detached or replacement node must never reach the send action',
  );
  assert.deepEqual(fixture.counters(), { inputEvents: 1, sends: 0, unrelatedInputReads: 0 });
  assert.equal(replacement.value, '继续当前方案');
  assert.equal(
    fixture.timers.pending.size,
    0,
    'a canceled send must not retry against the new node',
  );
});

test('locked direct quick phrases append to an existing draft without attempting to send', () => {
  const fixture = runtimeFixture('保留草稿');
  const result = fixture.context.panelCommand({ ...fixture.command(), submit: true });
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.composer.value, '保留草稿\n继续当前方案');
  assert.deepEqual(fixture.sendAttempts, []);
  assert.deepEqual(fixture.counters(), { inputEvents: 1, sends: 0, unrelatedInputReads: 0 });
  assert.equal(fixture.timers.pending.size, 0);
});

for (const draft of ['', '保留草稿']) {
  test(`locked quick phrases fill ${draft ? 'after an existing draft' : 'an empty input'} on cold start without next or outline`, () => {
    const fixture = runtimeFixture(draft);
    const { context } = fixture;
    assert.equal(context.runtimeEnabled(), true);
    context.scanCurrent(1, 0);
    assert.equal(context.contextState.lastAssistantHash, '', 'the answer scanner stays disabled');
    assert.equal(
      context.contextMatches(context.contextSnapshot()),
      false,
      'answer-bound actions remain stale',
    );
    const result = context.panelCommand(fixture.command());
    assert.equal(result.ok, true, result.message);
    assert.equal(fixture.composer.value, draft ? `${draft}\n继续当前方案` : '继续当前方案');
    assert.deepEqual(fixture.counters(), { inputEvents: 1, sends: 0, unrelatedInputReads: 0 });
    assert.equal(fixture.timers.pending.size, 0, 'fill-only must not schedule sending');
  });
}

for (const field of ['sessionId', 'generation', 'runtimeGeneration', 'missing source']) {
  test(`locked quick phrases reject ${field} mismatches without writing or sending`, () => {
    const fixture = runtimeFixture('保留草稿');
    const command = fixture.command();
    if (field === 'missing source') fixture.removeSource();
    else command.context[field] = field === 'sessionId' ? 'thread-b' : 2;
    const result = fixture.context.panelCommand(command);
    assert.equal(result.ok, false);
    assert.equal(fixture.composer.value, '保留草稿');
    assert.deepEqual(fixture.counters(), { inputEvents: 0, sends: 0, unrelatedInputReads: 0 });
    assert.equal(fixture.timers.pending.size, 0);
  });
}
