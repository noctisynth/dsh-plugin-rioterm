import * as React from 'react';
import type { PreferenceEditor } from '../../preferences/editor.ts';
import {
  changeField,
  type Field,
  type Fields,
  fieldsFrom,
  reapplyEdits,
  sameFields,
  validateFields,
} from './draft.ts';

interface Editing {
  before: Fields;
  fields: Fields;
  revision: number;
}

export function usePreferenceDraft(editor: PreferenceEditor) {
  const snapshot = React.useSyncExternalStore(
    React.useCallback((fn: () => void) => editor.subscribe(fn), [editor]),
    React.useCallback(() => editor.getSnapshot(), [editor]),
  );
  // A clean form follows the store without a synchronization effect. A dirty one
  // owns its original revision and user layer; base/value are never copied into it.
  const saved = React.useMemo(() => fieldsFrom(snapshot.user), [snapshot.user]);
  const base = React.useMemo(() => fieldsFrom(snapshot.base), [snapshot.base]);
  const [editing, setEditing] = React.useState<Editing>();
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<{ detail?: string }>();
  const inFlight = React.useRef(false);
  const fields = editing?.fields ?? saved;
  const { next, invalid } = React.useMemo(
    () => validateFields(fields),
    [fields],
  );
  const writable =
    snapshot.status === 'ready' &&
    snapshot.writable &&
    snapshot.revision !== undefined;
  const conflict =
    editing !== undefined &&
    snapshot.status === 'ready' &&
    snapshot.revision !== undefined &&
    editing.revision !== snapshot.revision;

  function revise(change: (current: Fields, before: Fields) => Fields): void {
    const revision = snapshot.revision;
    if (!writable || revision === undefined || inFlight.current) return;
    setFailure(undefined);
    setEditing((previous) => {
      const before = previous?.before ?? saved;
      const result = change(previous?.fields ?? saved, before);
      return sameFields(result, before)
        ? undefined
        : {
            before,
            fields: result,
            revision: previous?.revision ?? revision,
          };
    });
  }
  function cancel(): void {
    if (inFlight.current) return;
    setEditing(undefined);
    setFailure(undefined);
  }
  function rebase(): void {
    const revision = snapshot.revision;
    if (
      !writable ||
      !editing ||
      !conflict ||
      revision === undefined ||
      inFlight.current
    )
      return;
    const result = reapplyEdits(editing.before, fields, saved);
    setEditing(
      sameFields(result, saved)
        ? undefined
        : { before: saved, fields: result, revision },
    );
    setFailure(undefined);
  }
  async function save(): Promise<void> {
    if (!editing || !writable || conflict || invalid.length || inFlight.current)
      return;
    const latest = editor.getSnapshot();
    if (
      latest.status !== 'ready' ||
      !latest.writable ||
      editing.revision !== latest.revision
    )
      return;
    inFlight.current = true;
    setSaving(true);
    setFailure(undefined);
    try {
      if (await editor.save(next, editing.revision)) setEditing(undefined);
      else setFailure({});
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : '';
      setFailure(detail ? { detail } : {});
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return {
    status: snapshot.status,
    writable,
    conflict,
    dirty: Boolean(editing),
    saving,
    failure,
    fields,
    base,
    // Preview only: a rejected/blank field falls back to its inherited value. Never give this layer to save().
    preview: { ...snapshot.base, ...next },
    invalid,
    save,
    cancel,
    rebase,
    change: (key: Field, text: string) =>
      revise((current) => changeField(current, key, text)),
    undo: (key: Field) =>
      revise((current, before) => changeField(current, key, before[key] ?? '')),
    restore: () => revise(() => ({})),
  };
}
