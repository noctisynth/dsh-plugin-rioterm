import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alphaPercent,
  clamp,
  hsvToRgb,
  parseHex,
  rgbaToHex,
  rgbToHsv,
  withAlphaPercent,
} from '../src/pages/preferences/color-picker-model.ts';

test('hex parser expands exactly the supported formats and rejects CSS text', () => {
  for (const [input, expected] of [
    ['#abc', '#aabbcc'],
    ['#AbC8', '#aabbcc88'],
    ['#A0b1C2', '#a0b1c2'],
    ['#A0b1C280', '#a0b1c280'],
  ])
    assert.equal(rgbaToHex(parseHex(input)), expected);
  for (const input of [
    undefined,
    '',
    'red',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#ggg',
    '#fff;',
    ' #fff',
    '#abc\n',
    '#abcd\r\n',
    'var(--color)',
    'url(test)',
  ]) {
    assert.equal(parseHex(input), undefined, String(input));
  }
});

test('RGBA round trips preserve every alpha byte and explicit opaque alpha', () => {
  for (let a = 0; a <= 255; a++) {
    const color = { r: 21, g: 126, b: 243, a, hasAlpha: true };
    assert.deepEqual(parseHex(rgbaToHex(color)), color);
    assert.equal(withAlphaPercent(color, alphaPercent(a)).a, a);
  }
  assert.equal(rgbaToHex(parseHex('#fff')), '#ffffff');
  assert.equal(rgbaToHex(parseHex('#ffff')), '#ffffffff');
  assert.equal(alphaPercent(128), 50.2);
});

test('HSV covers primary/secondary boundaries, hue wrap, black and gray', () => {
  const colors = [
    '#ff0000',
    '#ffff00',
    '#00ff00',
    '#00ffff',
    '#0000ff',
    '#ff00ff',
  ];
  for (const [index, hex] of colors.entries()) {
    const rgba = parseHex(hex);
    const hsv = { h: index * 60, s: 1, v: 1 };
    assert.deepEqual(rgbToHsv(rgba), hsv);
    assert.deepEqual(hsvToRgb(hsv), { r: rgba.r, g: rgba.g, b: rgba.b });
  }
  assert.deepEqual(hsvToRgb({ h: 360, s: 1, v: 1 }), { r: 255, g: 0, b: 0 });
  assert.deepEqual(rgbToHsv(parseHex('#000'), 240), { h: 240, s: 0, v: 0 });
  assert.deepEqual(rgbToHsv(parseHex('#808080'), 300), {
    h: 300,
    s: 0,
    v: 128 / 255,
  });
  assert.deepEqual(hsvToRgb({ h: 240, s: 0.8, v: 0 }), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 240, s: 0, v: 1 }), {
    r: 255,
    g: 255,
    b: 255,
  });
});

test('RGB/HSV round trips and HSV edits preserve exact existing alpha', () => {
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        assert.deepEqual(hsvToRgb(rgbToHsv({ r, g, b })), { r, g, b });
      }
    }
  }
  const color = parseHex('#12345680');
  assert.equal(
    rgbaToHex({ ...color, ...hsvToRgb({ h: 180, s: 1, v: 1 }) }),
    '#00ffff80',
  );
  assert.equal(
    rgbaToHex(withAlphaPercent(parseHex('#123456'), 100)),
    '#123456',
  );
  assert.equal(
    rgbaToHex(withAlphaPercent(parseHex('#123456'), 50)),
    '#12345680',
  );
  assert.equal(
    rgbaToHex(withAlphaPercent(parseHex('#12345680'), 100)),
    '#123456ff',
  );
});

test('numeric boundaries never generate nonfinite or malformed CSS colors', () => {
  assert.equal(clamp(Number.NaN, 0, 1), 0);
  assert.equal(clamp(Infinity, 0, 1), 0);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(2, 0, 1), 1);
  assert.deepEqual(hsvToRgb({ h: NaN, s: Infinity, v: -1 }), {
    r: 0,
    g: 0,
    b: 0,
  });
  assert.equal(
    rgbaToHex({ r: NaN, g: 999, b: -3, a: Infinity, hasAlpha: true }),
    '#00ff0000',
  );
});
