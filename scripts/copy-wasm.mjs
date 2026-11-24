import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// The published JS glue and this binary must come from the same Rio release.
const source = new URL(
  '../wasm/librio_wasm_bg.wasm',
  import.meta.resolve('rioterm'),
);
const bytes = await readFile(source);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (
  sha256 !== '6e8474dfa944f9c743e7608802b4f69d7846aecb4862357f01ebacccbe76918f'
) {
  throw new Error(
    'Unexpected Rio WASM digest; review the pinned release before updating the asset.',
  );
}
const output = new URL('../lib/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('rioterm-0.1.8.wasm', output), bytes);
