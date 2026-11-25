/** 'refresh' updates a live query without moving the user's viewport. */
export type TerminalSearchDirection = 'first' | 'next' | 'previous' | 'refresh';

export interface TerminalSearchResult {
  /** One-based position among the retained matches, or zero for no match. */
  readonly index: number;
  readonly count: number;
  /** More matches exist than the navigable count. */
  readonly truncated: boolean;
}

export const EMPTY_SEARCH_RESULT: TerminalSearchResult = Object.freeze({
  index: 0,
  count: 0,
  truncated: false,
});

export interface TerminalSearch {
  search(
    query: string,
    direction: TerminalSearchDirection,
  ): TerminalSearchResult;
  clearSearch(): void;
}
