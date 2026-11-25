import type { SearchMatch, Terminal } from 'rioterm';
import {
  EMPTY_SEARCH_RESULT,
  type TerminalSearchDirection,
  type TerminalSearchResult,
} from '../terminal/search.ts';

const MATCH_LIMIT = 1000;

/** Rio expects a Rust regex and otherwise infers case sensitivity from capitals. */
function literalPattern(query: string): string {
  return `(?-i:${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`;
}

function highlight(term: Terminal, match: SearchMatch, reveal: boolean): void {
  const rows = term.options.rows;
  const history = term.historySize();
  const offset = term.displayOffset();
  // Hits use ring coordinates; selection endpoints are relative to the viewport
  // (including negative coordinates for a match outside a manually scrolled view).
  let top = history - offset;
  if (reveal && (match.startLine < top || match.endLine >= top + rows)) {
    // Show the whole match when it fits, otherwise show its start.
    const spare = Math.max(0, rows - (match.endLine - match.startLine + 1));
    const target = Math.min(
      history,
      Math.max(0, match.startLine - Math.floor(spare / 2)),
    );
    term.scrollLines(top - target); // local scroll; never use the PTY's wheel protocol
    top = target;
  }
  term.selectionBegin(match.startLine - top, match.startCol);
  term.selectionUpdate(match.endLine - top, match.endCol, true); // inclusive cell
}

/** Holds only this view's bounded hit coordinates; the grid/text stays in Rio. */
export class RioOutputSearch {
  private query = '';
  private matches: SearchMatch[] | undefined;
  private truncated = false;
  private index = -1;
  private anchor: SearchMatch | undefined;
  private ownsSelection = false;
  private manualSelection = false;

  /** Don't clear or replace a subsequent pointer drag, even on automatic refresh. */
  pointerSelecting(): void {
    this.ownsSelection = false;
    this.manualSelection = true;
  }

  private removeHighlight(term: Terminal): void {
    if (this.ownsSelection) term.clearSelection();
    this.ownsSelection = false;
  }

  clear(term: Terminal): void {
    this.removeHighlight(term);
    this.query = '';
    this.matches = undefined;
    this.anchor = undefined;
    this.index = -1;
    this.manualSelection = false;
  }

  /** One notification per clean → dirty transition, even for a cached miss. */
  invalidate(replaced = false): boolean {
    const notify = this.matches !== undefined;
    if (replaced) {
      // The old selection was freed with the parser. Never carry its coordinates
      // (or clear a pointer selection) into the replacement grid.
      this.anchor = undefined;
      this.index = -1;
      this.ownsSelection = false;
      this.manualSelection = false;
    }
    // Rio moves native selections with the grid. On a busy log, leave the
    // highlight painted until refresh verifies/replaces it, rather than flash
    // it off on the first byte of every burst.
    this.matches = undefined;
    return notify;
  }

  search(
    term: Terminal,
    query: string,
    direction: TerminalSearchDirection,
  ): TerminalSearchResult {
    if (query !== this.query || !query) this.clear(term);
    if (!query) return EMPTY_SEARCH_RESULT;
    this.query = query;
    if (direction !== 'refresh') this.manualSelection = false;
    if (!this.matches) {
      // Rio's findNext/findPrevious rescan and silently cap at 1000. Search once
      // per revision, asking for one extra hit so exactly 1000 is not truncated.
      const hits = term.search(literalPattern(query), MATCH_LIMIT + 1);
      this.truncated = hits.length > MATCH_LIMIT;
      if (this.truncated) hits.length = MATCH_LIMIT;
      this.matches = hits;
      if (this.anchor) {
        const anchor = this.anchor;
        const same = hits.findIndex(
          (hit) =>
            hit.startLine === anchor.startLine &&
            hit.startCol === anchor.startCol,
        );
        this.index = same !== -1 ? same : Math.min(this.index, hits.length - 1);
      }
    }
    const count = this.matches.length;
    if (!count) {
      this.removeHighlight(term);
      this.anchor = undefined;
      this.index = -1;
      return EMPTY_SEARCH_RESULT;
    }
    if (direction === 'first') this.index = 0;
    else if (direction === 'previous')
      this.index = (Math.max(this.index, 0) - 1 + count) % count;
    else if (direction === 'next') this.index = (this.index + 1) % count;
    else if (this.index < 0) this.index = 0;
    const hit = this.matches[this.index];
    if (hit) {
      this.anchor = hit;
      if (!this.manualSelection) {
        highlight(term, hit, direction !== 'refresh');
        this.ownsSelection = true;
      }
    }
    return { index: this.index + 1, count, truncated: this.truncated };
  }
}
