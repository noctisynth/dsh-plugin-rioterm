import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import type {
  TerminalSearch as SearchEngine,
  TerminalSearchDirection,
  TerminalSearchResult,
} from '../../terminal/search.ts';
import type { TerminalTranslate } from './messages.ts';
import type { TerminalViewState } from './terminal-mount.ts';

interface SearchProps extends SearchEngine {
  focusTerminal(): void;
  searchRevision: number;
  alwaysVisible?: boolean;
  status: TerminalViewState['status'];
  t: TerminalTranslate;
}

function isMac(platform: string) {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function findShortcut(event: KeyboardEvent, mac: boolean) {
  if (event.key.toLowerCase() !== 'f' || event.altKey) return false;
  return (
    (event.ctrlKey && event.shiftKey && !event.metaKey) ||
    (mac && event.metaKey && !event.ctrlKey && !event.shiftKey)
  );
}

function Magnifier() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m12.5 12.5 4 4" strokeLinecap="round" />
    </svg>
  );
}

function SearchSpinner() {
  return (
    <svg
      data-rio-search-loading="true"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="rio:shrink-0 rio:animate-search-spin rio:motion-reduce:animate-none"
    >
      <circle cx="10" cy="10" r="7" opacity="0.25" />
      <path d="M10 3a7 7 0 0 1 7 7" strokeLinecap="round" />
    </svg>
  );
}

export function TerminalSearch({
  focusTerminal,
  alwaysVisible = false,
  ...props
}: SearchProps) {
  const { status, t } = props;
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const returnToTrigger = React.useRef(false);
  const held = React.useRef(new Set<string>());
  const mac = isMac(globalThis.navigator?.platform ?? '');

  const show = React.useCallback(() => {
    if (input.current) {
      input.current.focus({ preventScroll: true });
      input.current.select();
    } else setOpen(true);
  }, []);
  const close = React.useCallback(() => {
    const node = root.current;
    const doc = node?.ownerDocument;
    // Restore only on explicit dismissal, never on unmount, blur or a future reconnect.
    if (
      doc &&
      !doc.hidden &&
      doc.hasFocus() &&
      node?.contains(doc.activeElement)
    ) {
      if (status === 'connected') focusTerminal();
      else if (alwaysVisible) returnToTrigger.current = true;
      else {
        // No trigger exists when disabled. Keep shortcuts reachable without taking PTY control.
        node
          .closest<HTMLElement>('[data-rio-terminal]')
          ?.focus({ preventScroll: true });
      }
    }
    setOpen(false);
  }, [focusTerminal, status, alwaysVisible]);
  React.useLayoutEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc || doc.hidden || !doc.hasFocus()) return;
    if (open) input.current?.focus({ preventScroll: true });
    else if (returnToTrigger.current) {
      returnToTrigger.current = false;
      root.current?.querySelector('button')?.focus({ preventScroll: true });
    }
  }, [open]);

  React.useLayoutEffect(() => {
    const node = root.current;
    const section = node?.closest<HTMLElement>('[data-rio-terminal]');
    if (!node || !section) return;
    const consume = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: KeyboardEvent) => {
      const key = e.code || e.key;
      const inControls = node.contains(e.target as Node);
      // A held Escape or button activation may repeat after focus returns to Rio.
      if (e.repeat && held.current.has(key) && !inControls) return consume(e);
      if (!e.repeat) held.current.delete(key);
      if (inControls) held.current.add(key);
      if (e.isComposing || e.keyCode === 229) return;
      if (findShortcut(e, mac)) {
        held.current.add(key);
        consume(e);
        show();
      } else if (
        open &&
        e.key === 'Escape' &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (inControls ||
          section
            .querySelector('[data-rio-viewport]')
            ?.contains(e.target as Node))
      ) {
        // The text field handles Escape itself so it can consult its IME session as well.
        if (e.target === input.current) return;
        held.current.add(key);
        consume(e);
        close();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (
        held.current.delete(e.code || e.key) &&
        !node.contains(e.target as Node)
      )
        consume(e);
    };
    // The Rio textarea has *native target* listeners, including extended-protocol keyup.
    // A React bubbling handler is too late to keep those events out of the shell.
    section.addEventListener('keydown', down, true);
    section.addEventListener('keyup', up, true);
    return () => {
      section.removeEventListener('keydown', down, true);
      section.removeEventListener('keyup', up, true);
    };
  }, [open, mac, show, close]);

  return (
    <div
      ref={root}
      className="rio:pointer-events-none rio:absolute rio:top-2 rio:end-2 rio:z-10 rio:max-w-[calc(100%_-_1rem)]"
    >
      {open ? (
        <FindBar {...props} input={input} close={close} />
      ) : alwaysVisible ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('findOutput')}
          title={`${t('findOutput')} (${mac ? '⌘F' : 'Ctrl+Shift+F'})`}
          aria-keyshortcuts={mac ? 'Meta+F Control+Shift+F' : 'Control+Shift+F'}
          className="rio:pointer-events-auto rio:size-7 rio:p-0"
          onClick={show}
        >
          <Magnifier />
        </Button>
      ) : null}
    </div>
  );
}

type BarProps = Omit<SearchProps, 'focusTerminal'> & {
  close(): void;
  input: React.RefObject<HTMLInputElement>;
};

function FindBar({
  search,
  clearSearch,
  searchRevision,
  status,
  t,
  input,
  close,
}: BarProps) {
  const [query, setQuery] = React.useState('');
  const [composing, setComposing] = React.useState(false);
  type CompletedSearch = {
    query: string;
    revision: number;
    result: TerminalSearchResult;
  };
  const [completed, setCompleted] = React.useState<CompletedSearch>();
  const last = React.useRef<CompletedSearch>();
  const statusId = React.useId();
  const waiting = status === 'loading' || status === 'opening';
  const run = React.useCallback(
    (value: string, direction: TerminalSearchDirection) => {
      // A cached miss may reuse EMPTY_SEARCH_RESULT. Commit the query and result
      // together so every completed search renders, even with identical results.
      const next = {
        query: value,
        revision: searchRevision,
        result: search(value, direction),
      };
      last.current = next;
      setCompleted(next);
    },
    [search, searchRevision],
  );
  React.useLayoutEffect(() => clearSearch, [clearSearch]);
  React.useEffect(() => {
    if (!query) {
      if (last.current) clearSearch();
      last.current = undefined;
      setCompleted(undefined);
      return;
    }
    if (waiting || composing) return;
    if (last.current?.query === query) {
      if (last.current.revision !== searchRevision) run(query, 'refresh');
      return;
    }
    const timer = setTimeout(() => {
      // A navigation gesture may already have committed this pending edit.
      if (last.current?.query !== query) run(query, 'first');
    }, 100);
    return () => clearTimeout(timer);
  }, [query, waiting, composing, run, clearSearch, searchRevision]);
  function navigate(direction: 'next' | 'previous') {
    if (query && !composing && !waiting) run(query, direction);
  }
  const current = completed?.query === query ? completed.result : undefined;
  const busy = Boolean(query) && !composing && (waiting || !current);
  const count =
    !query || composing
      ? ''
      : waiting
        ? t('findWaiting')
        : !current
          ? t('findPending')
          : current.count
            ? `${current.index} / ${current.count}${current.truncated ? '+' : ''}`
            : t('findNone');
  const disabled = !query || composing || waiting || current?.count === 0;
  return (
    <search
      aria-label={t('findOutput')}
      className="rio:pointer-events-auto rio:box-border rio:flex rio:w-96 rio:max-w-full rio:items-center rio:gap-1 rio:rounded-md rio:border rio:border-solid rio:border-border rio:bg-background rio:px-2 rio:py-1 rio:text-foreground rio:shadow-md"
    >
      <div className="rio:relative rio:min-w-0 rio:flex-1">
        <Input
          ref={input}
          size="sm"
          type="text"
          aria-label={t('findOutput')}
          aria-describedby={statusId}
          aria-busy={busy}
          title={busy ? undefined : count || undefined}
          placeholder={t('findOutput')}
          value={query}
          autoComplete="off"
          maxLength={1024}
          autoCapitalize="off"
          spellCheck={false}
          className="rio:border-0 rio:border-transparent rio:bg-muted rio:pe-[min(7rem,50%)]"
          onChange={(e) => setQuery(e.currentTarget.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setQuery(e.currentTarget.value);
            setComposing(false);
          }}
          onKeyDown={(e) => {
            if (
              composing ||
              e.nativeEvent.isComposing ||
              e.nativeEvent.keyCode === 229 ||
              e.altKey ||
              e.ctrlKey ||
              e.metaKey
            )
              return;
            if (e.key !== 'Enter' && e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') close();
            else navigate(e.shiftKey ? 'previous' : 'next');
          }}
        />
        <span
          data-rio-search-feedback="true"
          aria-hidden="true"
          className="rio:pointer-events-none rio:absolute rio:inset-y-0 rio:end-2 rio:flex rio:w-24 rio:max-w-[calc(50%_-_0.5rem)] rio:items-center rio:justify-end rio:text-xs rio:text-muted-foreground rio:tabular-nums"
        >
          {busy ? (
            <SearchSpinner />
          ) : (
            <span className="rio:truncate" title={count}>
              {count}
            </span>
          )}
        </span>
      </div>
      <span
        id={statusId}
        role="status"
        aria-atomic="true"
        className="rio:sr-only"
      >
        {count}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="rio:size-8 rio:shrink-0 rio:p-0"
        disabled={disabled}
        title={t('findPrevious')}
        aria-label={t('findPrevious')}
        onClick={() => navigate('previous')}
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="rio:size-8 rio:shrink-0 rio:p-0"
        disabled={disabled}
        title={t('findNext')}
        aria-label={t('findNext')}
        onClick={() => navigate('next')}
      >
        ↓
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="rio:size-8 rio:shrink-0 rio:p-0"
        title={t('findClose')}
        aria-label={t('findClose')}
        onClick={close}
      >
        ×
      </Button>
    </search>
  );
}
