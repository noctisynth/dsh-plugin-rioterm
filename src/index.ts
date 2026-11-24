import { open } from 'node:fs/promises';

const route = '/dsh-plugin-rioterm/wasm/0.1.8.wasm';
const wasm = new URL('./rioterm-0.1.8.wasm', import.meta.url);

// Only the host-owned capabilities this bundle consumes. `peer` is supplied
// by WebServer.readResource after carrier admission, never from HTTP headers.
interface Peer {
  readonly principal: { readonly kind: string };
  readonly signal: AbortSignal;
}
interface Host {
  connection: {
    admit(request: Request): { peer: Peer } | { rejection: 401 | 403 };
  };
  webServer: {
    register(route: {
      kind: 'exact';
      path: string;
      resource(request: Request, peer?: Peer): Promise<Response>;
    }): () => void;
  };
  effect(register: () => () => void, label: string): unknown;
}

const policy = {
  'cache-control': 'private, no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

function empty(status: number): Response {
  return new Response(null, { status, headers: policy });
}

async function serve(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: { ...policy, allow: 'GET, HEAD' },
    });
  }
  try {
    // Never derive a filesystem path from the caller's URL or headers.
    const file = await open(wasm, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile()) return empty(404);
      return new Response(
        request.method === 'HEAD' ? null : await file.readFile(),
        {
          headers: {
            ...policy,
            'content-type': 'application/wasm',
            'content-length': String(info.size),
          },
        },
      );
    } finally {
      await file.close();
    }
  } catch (error) {
    // Do not disclose installation paths or OS errors to the browser.
    return empty(
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500,
    );
  }
}

export const inject = ['webServer', 'connection'];

export function apply(ctx: Host): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: route,
        async resource(request, peer) {
          const admission =
            peer === undefined ? ctx.connection.admit(request) : { peer };
          if ('rejection' in admission) return empty(admission.rejection);
          if (
            admission.peer.signal.aborted ||
            admission.peer.principal.kind !== 'owner'
          ) {
            return empty(403);
          }
          return serve(request);
        },
      }),
    'dsh-plugin-rioterm: versioned WASM resource',
  );
}
