import type {
  PreferenceEditor,
  PreferenceSnapshot,
} from '../../preferences/editor.ts';
import type { RioOverrides } from '../../preferences/values.ts';
import {
  type Field,
  type Fields,
  fieldsFrom,
  sameFields,
  validateFields,
} from './draft.ts';

export type ChangeMode = 'immediate' | 'debounced';
interface Edit {
  text: string;
  // undefined: unfinished/invalid. Empty string: intentional inheritance.
  canonical: string | undefined;
  due: number;
}
interface Write {
  revision: number;
  target: Fields;
  sent: Map<Field, Edit>;
  before: PreferenceSnapshot;
  confirmBy?: number;
  echo?: PreferenceSnapshot;
  resetQueued?: boolean;
}

function makeEdit(key: Field, text: string, due: number): Edit {
  const { next, invalid } = validateFields(text ? { [key]: text } : {});
  return {
    text,
    canonical: invalid.length ? undefined : (fieldsFrom(next)[key] ?? ''),
    due,
  };
}
function put(fields: Fields, key: Field, text: string) {
  if (text) fields[key] = text;
  else delete fields[key];
}
function writable(host: PreferenceSnapshot) {
  return (
    host.status === 'ready' && host.writable && host.revision !== undefined
  );
}

/** One settings editor, one CAS write at a time. The mirror, not a successful
 * RPC, supplies the next revision. Edits are per-field intents, never a stale layer. */
export class PreferenceAutosave {
  private readonly editor: PreferenceEditor;
  private host: PreferenceSnapshot;
  private saved: Fields;
  private savedRevision: number | undefined;
  private readonly edits = new Map<Field, Edit>();
  private readonly composing = new Map<Field, string | undefined>();
  private write: Write | undefined;
  private interrupted: Write | undefined;
  private conflict = false;
  private failure: { detail?: string } | undefined;
  private connected = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private view: ReturnType<PreferenceAutosave['describe']>;

  constructor(editor: PreferenceEditor) {
    this.editor = editor;
    this.host = editor.getSnapshot();
    this.saved = fieldsFrom(this.host.user);
    this.savedRevision = this.host.revision;
    this.view = this.describe();
  }

  connect() {
    this.connected = true;
    const unsubscribe = this.editor.subscribe(this.advance);
    this.advance();
    return () => {
      this.connected = false;
      if (this.write) {
        this.interrupted = this.write;
        this.write = undefined;
        this.failure ??= {};
      }
      unsubscribe();
      clearTimeout(this.timer);
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;

  private describe() {
    const saved = this.edits.size ? this.saved : fieldsFrom(this.host.user);
    const fields = { ...saved };
    const valid = { ...saved };
    const invalid: Field[] = [];
    let pending = false;
    for (const [key, edit] of this.edits) {
      put(fields, key, edit.text);
      put(valid, key, edit.canonical ?? '');
      if (edit.canonical === undefined) invalid.push(key);
      else if (this.write?.sent.get(key) !== edit) pending = true;
    }
    return {
      status: this.host.status,
      writable: writable(this.host),
      base: fieldsFrom(this.host.base),
      fields,
      invalid,
      preview: { ...this.host.base, ...validateFields(valid).next },
      dirty: this.edits.size > 0,
      saving: Boolean(this.write),
      pending:
        pending && writable(this.host) && !this.conflict && !this.failure,
      conflict: this.conflict,
      failure: this.failure,
    };
  }

  // The host may omit an override equal to its inherited value, materialize
  // unrelated inherited fields, or leave its effective-config revision unchanged.
  // A clear must really disappear; a set may be reflected in either layer.
  private reflects(write: Write) {
    const inherited = fieldsFrom({ ...this.host.base, ...this.host.value });
    for (const [key, { canonical }] of write.sent) {
      const actual = this.saved[key] ?? (canonical ? inherited[key] : '');
      if (actual !== canonical) return false;
    }
    return true;
  }

  private acceptEcho(write: Write, echo: PreferenceSnapshot) {
    for (const [key, sent] of write.sent) {
      if (this.edits.get(key) === sent) this.edits.delete(key);
    }
    const echoed = fieldsFrom(echo.user);
    const base = fieldsFrom(echo.base);
    if (write.resetQueued) {
      // A reset confirmed before the echo also clears inherited rows that this
      // write materialized. Don't clear unrelated overrides from another writer.
      for (const key of Object.keys(echoed) as Field[]) {
        if (
          write.target[key] === undefined &&
          echoed[key] === base[key] &&
          echoed[key] === this.saved[key] &&
          !this.edits.has(key)
        )
          this.edits.set(key, makeEdit(key, '', 0));
      }
    }
    const superseded =
      echo.revision !== this.host.revision || !sameFields(echoed, this.saved);
    for (const key of this.edits.keys()) {
      // Don't overwrite a remote edit delivered together with our own receipt.
      const overlap =
        !write.sent.has(key) &&
        echoed[key] !== write.target[key] &&
        !(write.target[key] === undefined && echoed[key] === base[key]);
      if (superseded || overlap) this.conflict = true;
    }
  }

  private observe() {
    const latest = this.editor.getSnapshot();
    if (latest === this.host) return;
    this.host = latest;
    if (!writable(latest)) {
      if (this.edits.size) this.failure ??= {};
      if (this.write) this.interrupted = this.write;
      this.write = undefined; // a late RPC from the old host has no authority
    }
    if (latest.status !== 'ready' || latest.revision === undefined) return;
    const saved = fieldsFrom(latest.user);
    const changed =
      this.savedRevision !== latest.revision || !sameFields(this.saved, saved);
    this.savedRevision = latest.revision;
    this.saved = saved;
    if (this.write) {
      if (!this.write.echo && this.reflects(this.write)) {
        this.write.echo = latest;
        for (const key of this.write.sent.keys()) {
          if (this.composing.has(key)) this.composing.set(key, saved[key]);
        }
      }
    } else if (
      writable(latest) &&
      this.interrupted &&
      this.reflects(this.interrupted)
    ) {
      this.acceptEcho(this.interrupted, this.interrupted.echo ?? latest);
    } else if (changed && this.edits.size) {
      this.conflict = true;
    }
    if (writable(latest)) this.interrupted = undefined;
  }

  private confirm(write: Write, deadline: number) {
    if (this.reflects(write)) write.echo ??= this.host;
    if (write.echo) {
      this.acceptEcho(write, write.echo);
    } else if (
      write.revision !== this.host.revision ||
      !sameFields(fieldsFrom(write.before.user), this.saved)
    ) {
      this.conflict = true;
    } else {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        this.timer = setTimeout(this.advance, remaining);
        return;
      }
      // A lost mirror must not strand the form in Saving or trigger a resend.
      this.interrupted = write;
      this.failure = {};
    }
    this.write = undefined;
  }

  private advance = () => {
    if (!this.connected) return;
    clearTimeout(this.timer);
    this.observe();
    const write = this.write;
    if (write?.confirmBy !== undefined) this.confirm(write, write.confirmBy);
    if (!this.write && !this.failure && writable(this.host)) {
      for (const [key, edit] of this.edits) {
        if (edit.text === (this.saved[key] ?? '')) this.edits.delete(key);
      }
    }
    if (!this.edits.size) {
      this.failure = undefined;
      this.conflict = false;
    }
    if (!this.write && !this.failure && !this.conflict && writable(this.host))
      this.schedule();
    this.view = this.describe();
    for (const listener of this.listeners) listener();
  };

  private schedule() {
    const revision = this.host.revision;
    if (revision === undefined) return;
    const now = Date.now();
    const sent = new Map<Field, Edit>();
    const target = { ...this.saved };
    let earliest = Infinity;
    for (const [key, edit] of this.edits) {
      if (edit.canonical === undefined || this.composing.has(key)) continue;
      if (edit.due > now) earliest = Math.min(earliest, edit.due);
      else if (edit.canonical === (this.saved[key] ?? ''))
        this.edits.delete(key);
      else {
        sent.set(key, edit);
        put(target, key, edit.canonical);
      }
    }
    if (sent.size) {
      const write: Write = { revision, target, sent, before: this.host };
      this.write = write;
      void this.submit(write, validateFields(target).next);
    } else if (earliest < Infinity) {
      this.timer = setTimeout(this.advance, earliest - now);
    }
  }

  private async submit(write: Write, next: RioOverrides) {
    let accepted = false;
    let detail = '';
    try {
      accepted = await this.editor.save(next, write.revision);
    } catch (error) {
      detail =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : '';
    }
    if (!this.connected || this.write !== write) return;
    this.observe();
    if (this.write !== write) {
      this.advance();
      return;
    }
    if (accepted) write.confirmBy = Date.now() + 10_000;
    else {
      this.failure = detail ? { detail } : {};
      if (
        this.host.revision !== write.revision ||
        !sameFields(fieldsFrom(write.before.user), this.saved)
      )
        this.conflict = true;
      this.write = undefined;
    }
    this.advance();
  }

  change = (key: Field, text: string, mode: ChangeMode = 'debounced') => {
    this.observe();
    const composing = this.composing.has(key);
    if (!this.connected || (!composing && !writable(this.host))) return;
    if (
      composing &&
      this.composing.get(key) !== this.saved[key] &&
      text !== (this.saved[key] ?? '')
    )
      this.conflict = true;
    this.composing.delete(key);
    if (!writable(this.host)) this.failure ??= {};
    const sent = this.write?.sent.get(key);
    if (sent && sent.text === text) this.edits.set(key, sent);
    else if (!sent && text === (this.saved[key] ?? '')) this.edits.delete(key);
    else
      this.edits.set(
        key,
        makeEdit(key, text, mode === 'immediate' ? 0 : Date.now() + 600),
      );
    this.advance();
  };
  holdField = (key: Field) => {
    this.observe();
    if (!this.connected || !writable(this.host) || this.composing.has(key))
      return;
    this.composing.set(key, this.saved[key]);
    this.advance();
  };
  releaseField = (key: Field) => {
    if (!this.composing.delete(key)) return;
    const edit = this.edits.get(key);
    if (edit) edit.due = Date.now() + 600;
    this.advance();
  };
  flushField = (key: Field) => {
    const edit = this.edits.get(key);
    if (
      !edit ||
      this.composing.has(key) ||
      !this.connected ||
      edit.canonical === undefined ||
      this.write?.sent.get(key) === edit
    )
      return;
    edit.due = 0;
    this.advance();
  };
  undo = (key: Field) => {
    const sent = this.write?.sent.get(key);
    if (sent) this.edits.set(key, sent);
    else this.edits.delete(key);
    this.advance();
  };
  cancel = () => {
    if (this.write) return;
    this.interrupted = undefined;
    this.edits.clear();
    this.advance();
  };
  restore = () => {
    this.observe();
    if (!this.connected || !writable(this.host) || this.conflict) return;
    this.edits.clear();
    this.composing.clear();
    this.interrupted = undefined;
    this.failure = undefined;
    if (this.write) this.write.resetQueued = true;
    // Removing an in-flight addition is also an edit, even if not mirrored yet.
    for (const key of Object.keys({
      ...this.saved,
      ...this.write?.target,
    }) as Field[])
      this.edits.set(key, makeEdit(key, '', 0));
    this.advance();
  };
  private resume() {
    this.interrupted = undefined;
    this.failure = undefined;
    for (const edit of this.edits.values()) edit.due = 0;
    this.advance();
  }
  retry = () => {
    this.observe();
    if (this.failure && !this.conflict && !this.write && writable(this.host))
      this.resume();
  };
  rebase = () => {
    this.observe();
    if (!this.conflict || this.write || !writable(this.host)) return;
    this.conflict = false;
    this.resume();
  };
}
