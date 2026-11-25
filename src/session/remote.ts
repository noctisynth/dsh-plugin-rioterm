import type { TerminalLimits } from '../terminal/contracts.ts';

// Client-facing subset of @deepseek-ai/dsh-api-terminal-controller (0.2.2-rc.5).
// No import of Harness runtime packages: the composed gateway supplies the Remote.
export interface TerminalInfo {
  id: string;
  origin: 'agent' | 'user';
  control: 'agent' | 'user';
  state: 'running' | 'exited' | 'failed';
  cols: number;
  rows: number;
  exitCode: number | null;
}

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string; code?: string } };

export function value<T>(result: Result<T>): T {
  if (!result.ok) {
    if (result.error instanceof Error) throw result.error;
    throw Object.assign(new Error(result.error.message), result.error);
  }
  return result.value;
}

export interface InputWindow {
  maxBytes: number;
  frameOverheadBytes: number;
}
// Structural port for the installed Gateway's $stream. Only Gateway knows its
// carrier error class and Connection retry policy; never import its browser bundle.
export interface RemoteStreamOptions<Item> {
  name: string;
  open(signal: AbortSignal): AsyncIterable<Item>;
  ended(accepted: boolean): Error;
  carrierFailed(error: Error): void;
}
export interface ManagedRemoteStream<Item>
  extends AsyncIterable<{
    readonly generation: number;
    readonly value: Item;
    readonly signal: AbortSignal;
    accept(): void;
  }> {
  dispose(): Promise<void>;
}
export type RemoteStreamFactory = <Item>(
  options: RemoteStreamOptions<Item>,
) => ManagedRemoteStream<Item>;

export type RemoteFrame =
  | {
      type: 'snapshot';
      info: TerminalInfo;
      writable: boolean;
      sequence: number;
      screen: string;
      inputWindow?: InputWindow;
    }
  | { type: 'output'; sequence: number; data: string }
  | { type: 'state'; info: TerminalInfo; writable: boolean }
  | { type: 'ack'; sequence: number; refusal?: string };
export type WireInput =
  | { type: 'write'; data: string; typed?: boolean }
  | { type: 'resize'; cols: number; rows: number };
export type WireCommand = WireInput & { sequence: number };
export interface RemoteAttachment extends AsyncIterable<RemoteFrame> {
  send(command: WireCommand): void;
}
export interface TerminalRemote {
  environment(
    session: string,
    signal: AbortSignal,
  ): Promise<Result<TerminalLimits>>;
  list(session: string): Promise<Result<TerminalInfo[]>>;
  create(
    session: string,
    request: { id: string; cols: number; rows: number },
    signal: AbortSignal,
  ): Promise<Result<TerminalInfo>>;
  retain(
    session: string,
    id: string,
    signal: AbortSignal,
  ): AsyncIterable<{ type: 'retained' }>;
  attach(session: string, id: string, signal: AbortSignal): RemoteAttachment;
  close(session: string, id: string): Promise<Result<void>>;
}

export function owned(
  id: string,
  info: TerminalInfo | undefined,
): asserts info is TerminalInfo {
  if (
    !info ||
    info.id !== id ||
    info.origin !== 'user' ||
    info.control !== 'user'
  )
    throw new Error('Terminal identity or owner does not match this Rio tab.');
}
