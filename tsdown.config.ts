import { defineConfig } from 'tsdown';
import { compileUiStyles } from './build/ui-styles.ts';

const bundled = [
  'rioterm',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  /^@radix-ui\//,
  /^@floating-ui\//,
  'aria-hidden',
  'react-remove-scroll',
  'react-remove-scroll-bar',
  'react-style-singleton',
  'get-nonce',
  'use-callback-ref',
  'use-sidecar',
  'detect-node-es',
  'tslib',
];

// DSH loads classic scripts: evaluating the artifact must only register the factory.
// Inside the factory, CommonJS require resolves against the host's module table.
export default defineConfig({
  entry: { client: 'src/client.ts' },
  platform: 'neutral',
  inputOptions: { platform: 'browser' },
  target: 'es2022',
  format: 'cjs',
  outDir: 'lib',
  clean: false,
  dts: false,
  sourcemap: false,
  deps: {
    alwaysBundle: bundled,
    onlyBundle: bundled,
    neverBundle: [/^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/],
  },
  // wasm-bindgen has an import.meta.url fallback. Our client always passes a Response;
  // don't synthesize a Node URL helper (or resolve the WASM relative to a combo script).
  define: {
    'import.meta.url': 'document.baseURI',
    'process.env.NODE_ENV': JSON.stringify('production'),
    __RIO_UI_CSS__: JSON.stringify(await compileUiStyles()),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner:
      'window.__ModuleLoader__.load({id:"dsh-plugin-rioterm",factory(require){const module={exports:{}};const exports=module.exports;',
    footer: 'return module.exports;}});',
  },
});
