import * as React from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import type { PreferenceEditor } from '../../preferences/editor.ts';
import type { HostFonts } from '../../preferences/values.ts';
import { AdvancedFields } from './advanced-fields.tsx';
import { hintClass } from './fields.tsx';
import { FontFields } from './font-fields.tsx';
import type { PreferenceTranslate } from './messages.ts';
import { usePreferenceDraft } from './use-preference-draft.ts';

interface PreferencesPageProps {
  editor: PreferenceEditor;
  hostFonts: HostFonts;
  t: PreferenceTranslate;
}
type DraftState = ReturnType<typeof usePreferenceDraft>;

function Status({
  state,
  t,
  focusRef,
}: {
  state: DraftState;
  t: PreferenceTranslate;
  focusRef: React.Ref<HTMLParagraphElement>;
}) {
  let text = t(state.dirty ? 'unsaved' : 'saved');
  if (state.saving) text = t('saving');
  else if (!state.writable) {
    text = t(state.status === 'ready' ? 'readOnly' : state.status);
    if (state.dirty) text += ` · ${t('unsaved')}`;
  }
  return (
    <p role="status" ref={focusRef} tabIndex={-1} className={hintClass}>
      {text}
    </p>
  );
}

function FormActions({
  state,
  t,
  focusStatus,
}: {
  state: DraftState;
  t: PreferenceTranslate;
  focusStatus(): void;
}) {
  const invalid = state.invalid.length > 0;
  const locked = !state.writable || state.saving;
  const restoreHint = React.useId();
  return (
    <div className="rio:grid rio:min-w-0 rio:gap-2">
      {state.conflict && !state.saving && (
        <Alert role="group">
          <AlertTitle role="alert">{t('conflict')}</AlertTitle>
          <AlertDescription>{t('resolveHint')}</AlertDescription>
          <Button
            size="sm"
            variant="outline"
            className="rio:mt-2"
            disabled={locked}
            onClick={() => {
              state.rebase();
              focusStatus();
            }}
          >
            {t('keepEdits')}
          </Button>
        </Alert>
      )}
      {state.failure && !state.conflict && (
        <Alert variant="destructive">
          <AlertTitle>{t('failed')}</AlertTitle>
          <AlertDescription>
            {state.failure.detail || t('rejected')}
          </AlertDescription>
        </Alert>
      )}
      {invalid && (
        <div className="rio:grid rio:justify-items-start rio:gap-1">
          <p className="rio:m-0 rio:text-xs rio:text-destructive">
            {t('invalid')}: {state.invalid.map((key) => t(key)).join(', ')}.
          </p>
          {state.invalid.includes('latencyThreshold') && (
            <>
              <p className={hintClass}>{t('echoControlsHint')}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => {
                  state.undo('latencyThreshold');
                  focusStatus();
                }}
              >
                {t('undoLatency')}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="rio:flex rio:min-w-0 rio:flex-wrap rio:items-center rio:gap-2">
        <Button
          disabled={locked || !state.dirty || state.conflict || invalid}
          onClick={() => {
            void state.save();
          }}
        >
          {t('save')}
        </Button>
        <Button
          variant="outline"
          disabled={state.saving || !state.dirty}
          onClick={state.cancel}
        >
          {t('cancel')}
        </Button>
        <Button
          variant="outline"
          disabled={locked || !Object.keys(state.fields).length}
          aria-describedby={restoreHint}
          onClick={state.restore}
        >
          {t('restore')}
        </Button>
      </div>
      <p id={restoreHint} className={hintClass}>
        {t('restoreHint')}
      </p>
    </div>
  );
}

export function PreferencesPage({
  editor,
  hostFonts,
  t,
}: PreferencesPageProps): React.ReactElement {
  const state = usePreferenceDraft(editor);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const form = {
    fields: state.fields,
    base: state.base,
    change: state.change,
    invalid: state.invalid,
    t,
  };
  return (
    <section
      data-rio-ui="preferences"
      aria-label={t('title')}
      className="rio:box-border rio:grid rio:w-full rio:min-w-0 rio:gap-4 rio:text-foreground"
    >
      <header className="rio:grid rio:min-w-0 rio:gap-1">
        <h3 className="rio:m-0 rio:text-base rio:font-semibold">
          {t('title')}
        </h3>
        <p className={hintClass}>{t('description')}</p>
        <Status state={state} t={t} focusRef={statusRef} />
      </header>
      <fieldset
        disabled={!state.writable || state.saving}
        aria-label={t('title')}
        aria-busy={state.saving || state.status === 'loading'}
        className="rio:m-0 rio:grid rio:min-w-0 rio:gap-4 rio:border-0 rio:p-0"
      >
        <FontFields form={form} hostFonts={hostFonts} preview={state.preview} />
        <AdvancedFields form={form} />
      </fieldset>
      <FormActions
        state={state}
        t={t}
        focusStatus={() => statusRef.current?.focus()}
      />
    </section>
  );
}
