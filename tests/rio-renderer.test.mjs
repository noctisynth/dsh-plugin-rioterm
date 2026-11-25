import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { defaultTheme, initWasm, Terminal } from 'rioterm';
import {
  ansiNames,
  colorFields,
  resolvePreferences,
} from '../src/preferences/values.ts';
import { makeRioRenderer } from '../src/rio/renderer.ts';
import { defaultAnsiColor } from '../src/rio/theme-defaults.ts';

before(async () => {
  await initWasm(
    await readFile(
      new URL('../wasm/librio_wasm_bg.wasm', import.meta.resolve('rioterm')),
    ),
  );
});

const fgToken = 'var(--dsw-alias-label-primary, CanvasText)';
const bgToken = 'var(--dsw-alias-bg-base, Canvas)';
const themeKeys = [...colorFields, ...ansiNames];
const key = (text) => new TextEncoder().encode(text);

// Only ports used by Rio constructors: no browser, layout engine or pixel renderer.
function element(tag) {
  return {
    tag,
    style: {},
    children: [],
    set textContent(text) {
      this.children.length = 0;
      this.text = text;
    },
    get textContent() {
      return this.text;
    },
    append(child) {
      child.parent = this;
      this.children.push(child);
    },
    appendChild(child) {
      this.append(child);
      return child;
    },
    remove() {
      if (this.parent) {
        const children = this.parent.children;
        children.splice(children.indexOf(this), 1);
        this.parent = null;
      }
    },
    getBoundingClientRect: () => ({ left: 5, top: 10, width: 90, height: 18 }),
  };
}

function setup(t) {
  const term = new Terminal({ cols: 40, rows: 3 });
  const renderers = [];
  const root = Object.assign(element('div'), { isConnected: true });
  const draws = [];
  const swatches = [];
  const hostColors = {
    Canvas: 'rgb(18, 19, 20)',
    [fgToken]: 'rgb(170, 171, 172)',
    [bgToken]: 'rgb(20, 21, 22)',
    HighlightText: 'rgb(250, 251, 252)',
    Highlight: 'color(display-p3 0.6 0.3 0.2)',
  };
  // Deterministic reply from the color-conversion port. Record its paint requests
  // separately; distinguish every key and re-read, without emulating CSS or color spaces.
  const pixels = Object.fromEntries(
    themeKeys.map((name, i) => [name, `#${(0x2ad9a0 + i).toString(16)}`]),
  );
  const raf = new Map();
  let nextFrame = 0;
  const globals = new Map();
  function install(name, value) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  install('requestAnimationFrame', (fn) => {
    raf.set(++nextFrame, fn);
    return nextFrame;
  });
  install('cancelAnimationFrame', (id) => raf.delete(id));
  const doc = {
    body: element('body'),
    defaultView: {
      getComputedStyle(node) {
        assert.equal(
          node.parent,
          root,
          'sample CSS inside this mounted screen',
        );
        assert.equal(node.hidden, true);
        const color = hostColors[node.style.color] ?? node.style.color;
        const bg = node.style.backgroundColor;
        return {
          color,
          backgroundColor:
            bg === 'currentColor' ? color : (hostColors[bg] ?? bg),
        };
      },
    },
    createTextNode: (textContent) => ({ textContent }),
    createElement(tag) {
      const node = element(tag);
      if (tag === 'canvas') {
        node.getContext = (_kind, options) => {
          if (options?.alpha === false) {
            return {
              globalAlpha: 1,
              measureText: () => ({
                width: 8,
                actualBoundingBoxAscent: 8,
                actualBoundingBoxDescent: 2,
              }),
              setTransform() {},
              fillRect(...args) {
                draws.push(['rect', this.fillStyle, ...args]);
              },
              fillText(text, ...args) {
                draws.push([
                  'text',
                  text,
                  this.fillStyle,
                  this.globalAlpha,
                  ...args,
                  this.font,
                ]);
              },
            };
          }
          const paints = [];
          swatches.push(paints);
          return {
            fillRect(x, y, w, h) {
              paints.push([this.fillStyle, x, y, w, h]);
            },
            getImageData() {
              return {
                data: Uint8ClampedArray.from(
                  themeKeys.flatMap((k) => [
                    ...pixels[k]
                      .slice(1)
                      .match(/../g)
                      .map((c) => Number.parseInt(c, 16)),
                    255,
                  ]),
                ),
              };
            },
          };
        };
      }
      return node;
    },
  };
  install('document', doc);
  root.ownerDocument = doc;
  t.after(() => {
    for (const renderer of renderers) renderer.dispose();
    term.dispose();
    for (const [name, previous] of globals) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    }
  });
  return {
    term,
    root,
    hostColors,
    pixels,
    swatches,
    draws,
    raf,
    make(overrides = {}) {
      const preferences = resolvePreferences(
        overrides,
        { fontFamily: 'Mono Test', fontSize: 15 },
        swatches.length,
      );
      const renderer = makeRioRenderer(term, preferences, root);
      renderers.push(renderer);
      return renderer;
    },
    frame() {
      draws.length = 0;
      for (const [id, fn] of [...raf]) {
        raf.delete(id);
        fn();
      }
      return draws
        .filter(([kind]) => kind === 'text')
        .map(([, text]) => text)
        .join('');
    },
  };
}

test('DOM stays the default, with live DSH CSS, measured cells, and no speculative echo', (t) => {
  const { make, root, term, swatches } = setup(t);
  const view = make({
    predictiveEcho: true,
    cursorStyle: 'bar',
    lineHeight: 1.5,
  });
  assert.equal(view.element.tag, 'div');
  assert.equal(view.element.style.color, fgToken);
  assert.equal(view.element.style.backgroundColor, bgToken);
  assert.equal(view.element.children[1].style.backgroundColor, 'currentColor');
  assert.equal(view.element.style.fontFamily, 'Mono Test');
  assert.equal(view.element.style.fontSize, '15px');
  assert.equal(view.element.style.lineHeight, '1.5');
  assert.equal(view.cellWidth, 9);
  assert.equal(view.cellHeight, 18);
  assert.deepEqual(view.cellAt(20, 29), { col: 1, row: 1, sideRight: true });
  view.userInput(key('A'));
  view.resetPredictions();
  assert.equal(term.textRow(0).trim(), '');
  assert.equal(swatches.length, 0);
  assert.equal(root.children.length, 0);
  const custom = make({
    foreground: '#abcdef',
    background: '#012345',
    cursor: '#789abc',
  });
  assert.equal(custom.element.style.color, '#abcdef');
  assert.equal(custom.element.style.backgroundColor, '#012345');
  assert.equal(custom.element.children[1].style.backgroundColor, '#789abc');
});

test('DSH preset pins the shipped xterm defaults in all 16 slots; absent preset keeps Rio colors', (t) => {
  const desktop = [
    '#2e3436',
    '#cc0000',
    '#4e9a06',
    '#c4a000',
    '#3465a4',
    '#75507b',
    '#06989a',
    '#d3d7cf',
    '#555753',
    '#ef2929',
    '#8ae234',
    '#fce94f',
    '#729fcf',
    '#ad7fa8',
    '#34e2e2',
    '#eeeeec',
  ];
  assert.deepEqual(
    ansiNames.map((name) => defaultAnsiColor(name, 'dsh')),
    desktop,
  );
  assert.deepEqual(
    ansiNames.map((name) => defaultAnsiColor(name)),
    ansiNames.map((name) => defaultTheme[name]),
  );
  const { make, swatches } = setup(t);
  make({ renderer: 'canvas', ansiPreset: 'dsh' });
  assert.deepEqual(
    swatches[0].slice(-16).map(([color]) => color),
    desktop,
  );
});

test('actual DOM rows use system selection colors or explicit overrides and keep unselected ANSI runs', (t) => {
  const { make, term, frame } = setup(t);
  term.write('\x1b[31mR\x1b[0mQ');
  term.selectionBegin(0, 1);
  term.selectionUpdate(0, 1, true);
  const palette = Array(16).fill('');
  palette[1] = '#bcd';
  for (const [opts, red, selected] of [
    [{}, defaultTheme.red, 'color:HighlightText;background-color:Highlight'],
    [
      { ansiPreset: 'dsh' },
      '#cc0000',
      'color:HighlightText;background-color:Highlight',
    ],
    [
      {
        ansiPreset: 'dsh',
        palette,
        selectionForeground: '#ace',
        selectionBackground: '#1328',
      },
      '#bbccdd',
      'color:#aaccee;background-color:#11332288',
    ],
  ]) {
    const view = make(opts);
    frame();
    const [row] = view.element.children[0].children;
    const styleOf = (letter) =>
      row.children.find((run) => run.textContent === letter)?.style.cssText;
    assert.equal(styleOf('R'), `color:${red}`);
    assert.equal(styleOf('Q'), selected);
    view.dispose();
  }
});

for (const renderer of ['dom', 'canvas']) {
  test(`${renderer} brightens only bold low ANSI foregrounds, before inverse and selection`, (t) => {
    const { make, term, frame, draws, pixels } = setup(t);
    const palette = Array(16).fill('');
    palette[1] = '#123456';
    palette[9] = '#abcdef';
    for (const [ansiPreset, boldBright, enabled] of [
      ['rio', 'auto', false],
      ['dsh', 'auto', true],
      ['rio', 'always', true],
      ['dsh', 'always', true],
      ['rio', 'never', false],
      ['dsh', 'never', false],
    ]) {
      const view = make({ renderer, ansiPreset, boldBright, palette });
      const theme =
        renderer === 'canvas'
          ? pixels
          : {
              foreground: fgToken,
              background: bgToken,
              selectionForeground: 'HighlightText',
              selectionBackground: 'Highlight',
              ...Object.fromEntries(
                ansiNames.map((name, i) => [
                  name,
                  palette[i] || defaultAnsiColor(name, ansiPreset),
                ]),
              ),
            };
      const slot = (i) => theme[ansiNames[i]];
      const promoted = (i) => slot(enabled ? i + 8 : i);
      // [SGR, painted fg, painted bg, bold font]. Each sample starts from SGR 0.
      const cells = [
        ...Array.from({ length: 8 }, (_, i) => [
          [`1;${30 + i}`, promoted(i), theme.background, true],
          [`1;38;5;${i}`, promoted(i), theme.background, true],
        ]).flat(),
        ['1;31;22', slot(1), theme.background, false],
        ['1;39;41', theme.foreground, slot(1), true],
        ['1;91', slot(9), theme.background, true],
        ['1;38;5;8', slot(8), theme.background, true],
        ['1;38;5;244', '#808080', theme.background, true],
        ['1;38;2;0;0;2', '#000002', theme.background, true],
        ['1;31;48;5;4', promoted(1), slot(4), true],
        ['1;31;44;7', slot(4), promoted(1), true],
        [
          '1;31;44;7',
          theme.selectionForeground,
          theme.selectionBackground,
          true,
        ],
      ];
      const glyph = (col) => String.fromCharCode(65 + col);
      term.write(
        '\x1b[H\x1b[?25l' +
          cells.map(([sgr], col) => `\x1b[0;${sgr}m${glyph(col)}`).join(''),
      );
      term.selectionBegin(0, cells.length - 1);
      term.selectionUpdate(0, cells.length - 1, true);
      frame();
      for (const [col, [sgr, fg, bg, bold]] of cells.entries()) {
        const note = `${renderer} ${ansiPreset}/${boldBright} SGR ${sgr} at ${col}`;
        if (renderer === 'dom') {
          const [row] = view.element.children[0].children;
          const run = row.children.find((child) =>
            child.textContent.includes(glyph(col)),
          );
          const css = [
            fg !== theme.foreground && `color:${fg}`,
            bg !== theme.background && `background-color:${bg}`,
            bold && 'font-weight:bold',
          ]
            .filter(Boolean)
            .join(';');
          assert.equal(run?.style?.cssText ?? '', css, note);
        } else {
          const paint = draws.find(
            ([op, text]) => op === 'text' && text === glyph(col),
          );
          const rect = draws.find(
            ([op, , x, y, width]) =>
              op === 'rect' &&
              y === 0 &&
              x <= col * view.cellWidth &&
              x + width > col * view.cellWidth,
          );
          assert.deepEqual(
            [paint?.[2], rect?.[1], paint?.at(-1).startsWith('bold ')],
            [fg, bg, bold],
            note,
          );
        }
      }
      term.clearSelection();
      view.dispose();
    }
  });
}

test('Canvas resolves all theme slots inside the connected screen and samples again after a theme change', (t) => {
  const { make, term, swatches, hostColors, pixels, draws, root, frame } =
    setup(t);
  const palette = ansiNames.map((_name, i) =>
    i % 2 === 0 ? `#ab00${i.toString(16).padStart(2, '0')}` : '',
  );
  const p = {
    renderer: 'canvas',
    cursorStyle: 'underline',
    background: '#12345680',
    palette,
  };
  const first = make(p);
  assert.equal(first.element.tag, 'canvas');
  assert.equal(first.cellHeight, 20);
  const requested = swatches[0].map(([color]) => color);
  assert.deepEqual(requested, [
    hostColors.Canvas,
    hostColors[bgToken],
    p.background,
    hostColors[fgToken],
    hostColors[fgToken],
    hostColors.HighlightText,
    hostColors.Highlight,
    ...ansiNames.map((name, i) => palette[i] || defaultTheme[name]),
  ]);
  assert.equal(root.children.length, 0, 'remove local probe');
  assert.deepEqual(root.style, {}, 'do not style the host or the screen owner');
  const chars = 'abcdefghijklmnop';
  term.write([...chars].map((c, i) => `\x1b[38;5;${i}m${c}`).join(''));
  frame();
  assert.deepEqual(
    draws.filter(([op]) => op === 'text').map(([, c, color]) => [c, color]),
    ansiNames.map((name, i) => [chars[i], pixels[name]]),
  );
  assert.deepEqual(draws.at(-1), [
    'rect',
    pixels.cursor,
    16 * first.cellWidth,
    first.cellHeight - 2,
    first.cellWidth,
    2,
  ]);
  assert.ok(
    draws.some(([op, color]) => op === 'rect' && color === pixels.background),
  );
  term.selectionBegin(0, 0);
  term.selectionUpdate(0, 3, true);
  frame();
  assert.ok(
    draws.some(
      ([op, c, color]) =>
        op === 'text' && c === 'a' && color === pixels.selectionForeground,
    ),
  );
  assert.ok(
    draws.some(
      ([op, color]) => op === 'rect' && color === pixels.selectionBackground,
    ),
  );
  first.dispose();
  hostColors[bgToken] = 'rgb(245, 244, 243)';
  pixels.cursor = '#abcdef';
  const next = make({
    ...p,
    cursorStyle: 'bar',
    foreground: '#234567',
    selectionForeground: '#eeeeee',
    selectionBackground: '#555555',
  });
  assert.deepEqual(swatches[1].map(([color]) => color).slice(0, 7), [
    hostColors.Canvas,
    hostColors[bgToken],
    p.background,
    '#234567',
    '#234567',
    '#eeeeee',
    '#555555',
  ]);
  frame();
  assert.deepEqual(draws.at(-1), [
    'rect',
    pixels.cursor,
    16 * next.cellWidth,
    0,
    2,
    next.cellHeight,
  ]);
});

test('Canvas context or color sampling failure warns and falls back to the same DOM grid', (t) => {
  const { root, term, make } = setup(t);
  term.write('keep this shell');
  const warnings = t.mock.method(console, 'warn', () => {});
  root.isConnected = false;
  const p = { renderer: 'canvas', predictiveEcho: true };
  assert.equal(make(p).element.tag, 'div');
  root.isConnected = true;
  const doc = root.ownerDocument;
  const css = t.mock.method(doc.defaultView, 'getComputedStyle', () => {
    throw new Error('color read unavailable');
  });
  assert.equal(make(p).element.tag, 'div');
  assert.equal(
    root.children.length,
    0,
    'a failed color read removes its probe',
  );
  css.mock.restore();
  const createElement = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = createElement(tag);
    if (tag === 'canvas') {
      const get = el.getContext.bind(el);
      el.getContext = (kind, options) =>
        options?.alpha === false ? null : get(kind, options);
    }
    return el;
  };
  assert.equal(make(p).element.tag, 'div');
  assert.equal(root.children.length, 0);
  assert.equal(term.textRow(0).trimEnd(), 'keep this shell');
  assert.equal(warnings.mock.callCount(), 3);
  assert.match(warnings.mock.calls[0].arguments[0], /Canvas.*DOM/);
});

test('only explicitly enabled Canvas predicts; first and subsequent no-echo keys never paint literal input', (t) => {
  const { make, term, frame, raf } = setup(t);
  const sent = [];
  term.onData((bytes) => sent.push(new TextDecoder().decode(bytes)));
  term.write('Password: ');
  const off = make({ renderer: 'canvas' });
  off.userInput(key('Q'));
  assert.equal(frame(), 'Password:');
  off.dispose();
  const view = make({
    renderer: 'canvas',
    predictiveEcho: true,
    latencyThreshold: 0,
  });
  view.userInput(key('Q'));
  assert.equal(frame(), 'Password:•');
  view.userInput(key('7'));
  assert.equal(frame(), 'Password:••');
  assert.equal(term.textRow(0).trimEnd(), 'Password:');
  assert.deepEqual(
    sent,
    [],
    'painting does not write to either the grid or the transport',
  );
  view.resetPredictions(); // Used by readonly, hide, input boundaries and snapshot.
  assert.equal(frame(), 'Password:');
  term.write('\x1b[6n');
  term.paste('Q');
  assert.equal(frame(), 'Password:');
  assert.deepEqual(
    sent,
    ['\x1b[1;11R', 'Q'],
    'no renderer subscription to unclassified bytes',
  );
  for (const ignored of ['\r', '\x1b[6n', '\x1b[200~Q\x1b[201~', 'ab', '汉']) {
    view.userInput(key(ignored));
    assert.equal(frame(), 'Password:');
  }
  view.userInput(key('Z'));
  term.write('\x1b[?1049h');
  assert.equal(frame(), '');
  view.userInput(key('Z'));
  assert.equal(frame(), '');
  term.write('\x1b[?1049l\x1b[?25l');
  view.userInput(key('X'));
  assert.equal(frame(), 'Password:');
  view.dispose();
  view.userInput(key('K'));
  view.resetPredictions();
  assert.equal(raf.size, 0);
});

test('actual echoes reconcile once; threshold and slow-link style come from the upstream engine', (t) => {
  const { make, term, frame, draws, pixels } = setup(t);
  let now = 10;
  t.mock.method(performance, 'now', () => now);
  for (const [style, threshold] of [
    ['underline', 0],
    ['dim', 30],
    ['dim', 200],
  ]) {
    const view = make({
      renderer: 'canvas',
      predictiveEcho: true,
      predictionStyle: style,
      latencyThreshold: threshold,
    });
    view.userInput(key('Q'));
    assert.ok(frame().endsWith('•'));
    now += 100;
    term.write('Q');
    assert.equal(
      frame().includes('•'),
      false,
      'only the actual grid now draws Q',
    );
    view.userInput(key('K'));
    const text = frame();
    assert.equal(text.includes('K'), false);
    if (threshold === 200) assert.equal(text.includes('•'), false);
    else {
      assert.equal(
        draws.find(([op, c]) => op === 'text' && c === '•')[3],
        style === 'dim' ? 0.6 : 1,
      );
      const hasUnderline = draws.some(
        ([op, color, , , , h]) =>
          op === 'rect' && color === pixels.foreground && h === 1,
      );
      assert.equal(hasUnderline, style === 'underline');
    }
    view.dispose();
    now += 50;
  }
});

test('an idle no-echo overlay expires even when no further PTY frame arrives', (t) => {
  const { make, frame } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = make({ renderer: 'canvas', predictiveEcho: true });
  view.userInput(key('K'));
  assert.equal(frame(), '•');
  t.mock.timers.tick(1501);
  assert.equal(frame(), '');
});
