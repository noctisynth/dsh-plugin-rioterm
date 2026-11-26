import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import type { HostFonts } from '../../preferences/values.ts';
import { ColorFields } from './color-fields.tsx';
import type { Field } from './draft.ts';
import { hintClass, settingsButtonClass } from './fields.tsx';
import { FontLayoutFields } from './font-fields.tsx';
import { InteractionFields } from './interaction-fields.tsx';
import type { PreferenceTranslate } from './messages.ts';
import type { PreferenceAutosave } from './preference-autosave.ts';
import { RenderingFields } from './rendering-fields.tsx';
import { SaveIndicator, type SaveIndicatorKind } from './save-indicator.tsx';
import { usePreferenceDraft } from './use-preference-draft.ts';

interface PreferencesPageProps {
  draft: PreferenceAutosave;
  hostFonts: HostFonts;
  t: PreferenceTranslate;
}
type DraftState = ReturnType<typeof usePreferenceDraft>;

function statusText(state: DraftState, t: PreferenceTranslate) {
  if (!state.writable) {
    const reason = t(state.status === 'ready' ? 'readOnly' : state.status);
    return state.dirty ? `${reason} ${t('retained')}` : reason;
  }
  if (state.conflict) return t('conflict');
  if (state.failure) return t('failed');
  if (state.invalid.length) return t('invalidStatus');
  if (state.saving) return t('saving');
  return t(state.pending ? 'pending' : 'saved');
}

function saveIndicatorKind(state: DraftState): SaveIndicatorKind {
  if (state.status === 'loading') return 'busy';
  if (!state.writable)
    return state.status === 'ready' ? 'readonly' : 'attention';
  if (state.conflict || state.failure || state.invalid.length)
    return 'attention';
  if (state.saving) return 'busy';
  return state.pending ? 'pending' : 'saved';
}

// Only an explicit error-summary action opens sections or moves focus. For a
// hidden threshold, lead to the control that can reveal it; never edit the draft.
function revealField(fieldset: HTMLFieldSetElement | null, name: Field) {
  if (!fieldset) return;
  const find = (key: Field) =>
    fieldset.querySelector<HTMLElement>(`[name="${key}"]`);
  const target =
    find(name) ??
    (name === 'latencyThreshold' &&
      (find('predictiveEcho') ?? find('renderer')));
  if (!target) return;
  for (
    let section = target.closest('details');
    section && fieldset.contains(section);
    section = section.parentElement?.closest('details') ?? null
  ) {
    section.open = true;
  }
  target.focus();
}

function RecoveryActions({
  state,
  t,
  focusStatus,
  focusField,
}: {
  state: DraftState;
  t: PreferenceTranslate;
  focusStatus(): void;
  focusField(name: Field): void;
}) {
  const invalid = state.invalid.length > 0;
  const resolve = (action: () => void) => {
    action();
    focusStatus(); // The activated recovery button can disappear.
  };
  return (
    <div className="rio:grid rio:min-w-0 rio:gap-2">
      {state.conflict ? (
        <p className={hintClass}>{t('resolveHint')}</p>
      ) : state.failure ? (
        <p className={hintClass}>{state.failure.detail || t('rejected')}</p>
      ) : null}
      {invalid && (
        <section
          aria-label={t('invalid')}
          className="rio:grid rio:justify-items-start rio:gap-1"
        >
          <p className="rio:m-0 rio:text-xs rio:font-medium rio:text-destructive">
            {t('invalid')}:
          </p>
          <div className="rio:flex rio:flex-wrap rio:gap-2">
            {state.invalid.map((name) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                className={settingsButtonClass}
                disabled={!state.writable}
                onClick={() => focusField(name)}
              >
                {t(name)}
              </Button>
            ))}
          </div>
          {state.invalid.includes('latencyThreshold') && (
            <>
              <p className={hintClass}>{t('echoControlsHint')}</p>
              <Button
                size="sm"
                className={settingsButtonClass}
                variant="outline"
                disabled={!state.writable}
                onClick={() => resolve(() => state.undo('latencyThreshold'))}
              >
                {t('undoLatency')}
              </Button>
            </>
          )}
        </section>
      )}
      <div className="rio:flex rio:flex-wrap rio:gap-2">
        {state.conflict ? (
          <Button
            size="sm"
            className={settingsButtonClass}
            variant="outline"
            disabled={!state.writable || state.saving}
            onClick={() => resolve(state.rebase)}
          >
            {t('keepEdits')}
          </Button>
        ) : state.failure ? (
          <Button
            size="sm"
            className={settingsButtonClass}
            variant="outline"
            disabled={!state.writable || state.saving}
            onClick={() => resolve(state.retry)}
          >
            {t('retry')}
          </Button>
        ) : null}
        <Button
          size="sm"
          className={settingsButtonClass}
          variant="outline"
          disabled={state.saving}
          onClick={() => resolve(state.cancel)}
        >
          {t('discard')}
        </Button>
      </div>
    </div>
  );
}

function RestoreDefaults({
  restore,
  t,
  focusStatus,
}: {
  restore(): void;
  t: PreferenceTranslate;
  focusStatus(): void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const hint = React.useId();
  return (
    <div className="rio:ms-auto rio:grid rio:min-w-0 rio:max-w-full rio:justify-items-end rio:gap-2">
      {confirming && (
        <p id={hint} className={`${hintClass} rio:max-w-80 rio:text-end`}>
          {t('confirmRestoreHint')}
        </p>
      )}
      <div className="rio:flex rio:flex-wrap rio:justify-end rio:gap-2">
        <Button
          variant="outline"
          size="sm"
          className={settingsButtonClass}
          aria-expanded={confirming}
          onClick={() => setConfirming(!confirming)}
        >
          {t(confirming ? 'keepSettings' : 'restore')}
        </Button>
        {confirming && (
          <Button
            size="sm"
            className={settingsButtonClass}
            aria-describedby={hint}
            onClick={() => {
              setConfirming(false);
              restore();
              focusStatus();
            }}
          >
            {t('confirmRestore')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PreferencesPage({
  draft,
  hostFonts,
  t,
}: PreferencesPageProps): React.ReactElement {
  const state = usePreferenceDraft(draft);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const fieldsRef = React.useRef<HTMLFieldSetElement>(null);
  const messageId = React.useId();
  const kind = saveIndicatorKind(state);
  const showStatusMessage = kind === 'attention' || kind === 'readonly';
  const label = statusText(state, t);
  const focusStatus = () => statusRef.current?.focus();
  const needsReview =
    state.dirty &&
    (!state.writable ||
      state.conflict ||
      state.failure ||
      state.invalid.length > 0);
  const form = {
    fields: state.fields,
    base: state.base,
    sourcesReady: state.status === 'ready',
    writable: state.writable,
    change: state.change,
    flushField: state.flushField,
    holdField: state.holdField,
    releaseField: state.releaseField,
    invalid: state.invalid,
    t,
  };
  return (
    <section
      data-rio-ui="preferences"
      aria-label={t('title')}
      className="rio:@container rio:box-border rio:grid rio:w-full rio:min-w-0 rio:gap-6 rio:text-foreground"
    >
      <header className="rio:grid rio:min-w-0 rio:gap-2 rio:border-0 rio:border-b-[0.5px] rio:border-solid rio:border-border rio:pb-4">
        <div className="rio:flex rio:min-w-0 rio:flex-wrap rio:items-center rio:gap-x-4 rio:gap-y-2">
          <div className="rio:grid rio:min-w-0 rio:flex-1 rio:basis-64 rio:gap-1">
            <div className="rio:flex rio:min-w-0 rio:items-center rio:gap-2">
              <h3 className="rio:m-0 rio:min-w-0 rio:text-base rio:font-semibold rio:wrap-anywhere">
                {t('title')}
              </h3>
              <SaveIndicator
                kind={kind}
                text={label}
                statusRef={statusRef}
                messageId={showStatusMessage ? messageId : undefined}
              />
            </div>
            <p className={hintClass}>{t('description')}</p>
          </div>
          {state.writable &&
            !state.conflict &&
            !state.failure &&
            Object.keys(state.fields).length > 0 && (
              <RestoreDefaults
                restore={state.restore}
                t={t}
                focusStatus={focusStatus}
              />
            )}
        </div>
        {showStatusMessage && (
          <p
            id={messageId}
            className={cn(
              hintClass,
              kind === 'attention' && 'rio:text-destructive',
            )}
          >
            {label}
          </p>
        )}
        {needsReview && (
          <RecoveryActions
            state={state}
            t={t}
            focusStatus={focusStatus}
            focusField={(name) => revealField(fieldsRef.current, name)}
          />
        )}
      </header>
      <fieldset
        ref={fieldsRef}
        disabled={!state.writable}
        aria-label={t('title')}
        aria-busy={state.status === 'loading'}
        className="rio:m-0 rio:grid rio:min-w-0 rio:gap-8 rio:border-0 rio:p-0"
      >
        <FontLayoutFields
          form={form}
          hostFonts={hostFonts}
          preview={state.preview}
        />
        <ColorFields form={form} />
        <InteractionFields form={form} />
        <RenderingFields form={form} />
      </fieldset>
      {needsReview && (
        <Button
          size="sm"
          variant="outline"
          className={`${settingsButtonClass} rio:justify-self-start`}
          onClick={focusStatus}
        >
          {t('reviewIssue')}
        </Button>
      )}
    </section>
  );
}
