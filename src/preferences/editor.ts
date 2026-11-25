import type { RioOverrides } from './values.ts';
export interface PreferenceSnapshot {
  status: 'loading' | 'ready' | 'unavailable';
  writable: boolean;
  revision: number | undefined;
  user: RioOverrides;
  base: RioOverrides;
  value: RioOverrides;
}
export interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
export interface PreferenceEditor extends Observable<PreferenceSnapshot> {
  save(next: RioOverrides, revision: number): Promise<boolean>;
}
