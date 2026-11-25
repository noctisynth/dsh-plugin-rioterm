import { initWasm } from 'rioterm';
import { errorMessage } from '../terminal/error-message.ts';

const wasmPath = 'dsh-plugin-rioterm/wasm/0.1.8.wasm';
export class ResourceError extends Error {}
let wasmReady: Promise<void> | undefined;
export function loadWasm(reload = false): Promise<void> {
  wasmReady ??= (async () => {
    let response: Response;
    try {
      response = await fetch(new URL(wasmPath, document.baseURI), {
        mode: 'same-origin',
        credentials: 'same-origin',
        cache: reload ? 'reload' : 'default',
      });
      if (!response.ok) throw new Error(`WASM: HTTP ${response.status}`);
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim() !==
        'application/wasm'
      )
        throw new Error('WASM: expected Content-Type application/wasm');
    } catch (cause) {
      throw new ResourceError(errorMessage(cause));
    }
    // The upstream WASM initializer also memoizes *rejections*. Retrying a failed
    // fetch is meaningful; retrying a failed instantiation requires a fresh page.
    await initWasm(response);
  })().catch((error: unknown) => {
    wasmReady = undefined;
    throw error;
  });
  return wasmReady;
}
