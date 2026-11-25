import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import {
  preferenceDefaults,
  type RioPreferenceValues,
} from '../../preferences/values.ts';
import {
  type Field,
  type Fields,
  fieldsFrom,
  validateFields,
} from './draft.ts';
import type { PreferenceTranslate } from './messages.ts';

export interface FieldForm {
  fields: Fields;
  base: Fields;
  sourcesReady: boolean;
  invalid: readonly Field[];
  change(key: Field, text: string, mode?: 'immediate'): void;
  flushField(key: Field): void;
  holdField(key: Field): void;
  releaseField(key: Field): void;
  t: PreferenceTranslate;
}

export const controlClass =
  'rio:box-border rio:block rio:min-h-9 rio:w-full rio:min-w-0 rio:max-w-full rio:rounded-md rio:border rio:border-solid rio:border-border rio:bg-background rio:px-2.5 rio:py-1.5 rio:[font-family:inherit] rio:text-sm rio:text-foreground rio:placeholder:text-muted-foreground rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-1 rio:aria-invalid:border-destructive rio:disabled:opacity-60';
export const hintClass =
  'rio:m-0 rio:text-xs rio:leading-relaxed rio:text-muted-foreground rio:wrap-anywhere';

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const heading = React.useId();
  return (
    <section
      aria-labelledby={heading}
      className="rio:grid rio:min-w-0 rio:gap-1"
    >
      <header className="rio:border-0 rio:border-b rio:border-solid rio:border-border rio:pb-1.5">
        <h4 id={heading} className="rio:m-0 rio:text-sm rio:font-semibold">
          {title}
        </h4>
        {description && <p className={hintClass}>{description}</p>}
      </header>
      {children}
    </section>
  );
}

// The same settings slot can occupy a full page or a narrow panel. Respond to
// the nearest container (page or disclosure), never the browser viewport.
export function SettingsRow({
  label,
  description,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rio:grid rio:min-w-0 rio:items-center rio:gap-x-4 rio:gap-y-1 rio:py-1 rio:@min-[30rem]:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
      <div className="rio:grid rio:min-w-0 rio:gap-0.5 rio:wrap-anywhere">
        <div className="rio:text-sm rio:font-medium">{label}</div>
        {description && <div className={hintClass}>{description}</div>}
      </div>
      <div className="rio:min-w-0">{children}</div>
    </div>
  );
}

export function Disclosure({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <details className="rio:min-w-0 rio:rounded-md rio:border rio:border-solid rio:border-border rio:bg-background">
      <summary
        aria-labelledby={id}
        aria-describedby={description ? `${id}-description` : undefined}
        className="rio:cursor-pointer rio:rounded-md rio:px-3 rio:py-2.5 rio:text-sm rio:font-medium rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:-outline-offset-2"
      >
        <span id={id}>{title}</span>
        {description && (
          <span
            id={`${id}-description`}
            className={cn(hintClass, 'rio:block rio:font-normal')}
          >
            {description}
          </span>
        )}
      </summary>
      <div className="rio:@container rio:grid rio:min-w-0 rio:gap-1 rio:px-3 rio:pb-2">
        {children}
      </div>
    </details>
  );
}

function LabeledField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <SettingsRow
      label={<label htmlFor={id}>{label}</label>}
      description={hint && <span id={`${id}-hint`}>{hint}</span>}
    >
      {children}
    </SettingsRow>
  );
}

// Keep the caret and a user's spelling (e.g. `1.` or an unquoted font) when
// the host acknowledges its canonical equivalent. A different host value still
// wins when there is no pending edit. IME candidates never enter autosave.
export function PreferenceTextInput({
  form,
  name,
  inputRef,
  ...props
}: Omit<React.ComponentPropsWithoutRef<'input'>, 'form' | 'name'> & {
  form: FieldForm;
  name: Field;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const composing = React.useRef(false);
  const focused = React.useRef(false);
  const [candidate, setCandidate] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState<string | null>(null);
  const { releaseField } = form;
  React.useEffect(
    () => () => {
      // The page or a conditional field may disappear before compositionend.
      // Resume the last committed edit, never this component's private candidate.
      if (composing.current) releaseField(name);
    },
    [name, releaseField],
  );
  const stored = form.fields[name] ?? '';
  let display = stored;
  if (typed !== null && typed !== stored) {
    const { next, invalid } = validateFields({ [name]: typed });
    if (!invalid.length && (fieldsFrom(next)[name] ?? '') === stored)
      display = typed;
  }
  const commit = (text: string) => {
    if (focused.current) setTyped(text);
    form.change(name, text);
  };
  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      name={name}
      value={candidate ?? display}
      onFocus={() => {
        focused.current = true;
      }}
      onCompositionStart={(event) => {
        composing.current = true;
        setCandidate(event.currentTarget.value);
        form.holdField(name);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        setCandidate(null);
        commit(event.currentTarget.value);
      }}
      onChange={(event) => {
        if (composing.current) setCandidate(event.currentTarget.value);
        else commit(event.currentTarget.value);
      }}
      onBlur={() => {
        focused.current = false;
        setTyped(null);
        if (!composing.current) form.flushField(name);
      }}
    />
  );
}

type TextName =
  | 'fontFamily'
  | 'fontSize'
  | 'lineHeight'
  | 'scrollback'
  | 'latencyThreshold';
export function TextField({
  form,
  name,
  fallback,
  hint,
  range,
}: {
  form: FieldForm;
  name: TextName;
  fallback: string;
  hint?: string;
  range?: readonly [number, number];
}) {
  const id = React.useId();
  const { base, t } = form;
  const invalid = form.invalid.includes(name);
  const decimal = name === 'lineHeight';
  const rangeHint =
    range &&
    `${t(decimal ? 'decimalRange' : 'integerRange')}: ${range.join('–')}.`;
  const description = [
    hint,
    rangeHint,
    invalid && name === 'fontFamily' && t('invalidFamily'),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <LabeledField id={id} label={t(name)} hint={description}>
      {/* Text + inputMode keeps unfinished numbers visible; a number input turns some invalid keystrokes into the same empty string as an intentional unset. */}
      <PreferenceTextInput
        form={form}
        id={id}
        name={name}
        placeholder={base[name] ?? fallback}
        inputMode={range ? (decimal ? 'decimal' : 'numeric') : 'text'}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={description ? `${id}-hint` : undefined}
        className={cn(controlClass, range && 'rio:max-w-40')}
      />
    </LabeledField>
  );
}

type ChoiceName =
  | 'renderer'
  | 'cursorStyle'
  | 'predictionStyle'
  | 'ansiPreset'
  | 'boldBright';
export function ChoiceField<K extends ChoiceName>({
  form,
  name,
  options,
  hint,
}: {
  form: FieldForm;
  name: K;
  options: readonly RioPreferenceValues[K][];
  hint?: string;
}) {
  const id = React.useId();
  const { fields, base, t } = form;
  const inherited =
    options.find((choice) => choice === base[name]) ?? preferenceDefaults[name];
  const source =
    name === 'ansiPreset' && form.sourcesReady
      ? t(base[name] !== undefined ? 'useProfilePalette' : 'autoPalette')
      : t('inherited');
  return (
    <LabeledField id={id} label={t(name)} hint={hint}>
      <select
        id={id}
        name={name}
        className={controlClass}
        value={fields[name] ?? ''}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) =>
          form.change(name, event.currentTarget.value, 'immediate')
        }
      >
        <option value="">
          {source}: {form.sourcesReady ? t(inherited) : t('unknownValue')}
        </option>
        {options.map((choice) => (
          <option value={choice} key={choice}>
            {t(choice)}
          </option>
        ))}
      </select>
    </LabeledField>
  );
}

type ToggleName =
  | 'altIsMeta'
  | 'detectUrls'
  | 'predictiveEcho'
  | 'autoFocus'
  | 'fit';
export function ToggleField({
  form,
  name,
  hint,
}: {
  form: FieldForm;
  name: ToggleName;
  hint?: string;
}) {
  const id = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { fields, base, t } = form;
  const inherited = base[name] ?? String(preferenceDefaults[name]);
  const value = fields[name];
  const inheritance = `${t(value === undefined ? 'inherited' : 'ifCleared')}: ${form.sourcesReady ? t(inherited === 'true' ? 'on' : 'off') : t('unknownValue')}`;
  return (
    <SettingsRow
      label={
        <label htmlFor={id} className="rio:cursor-pointer">
          {t(name)}
        </label>
      }
      description={hint && <span id={`${id}-hint`}>{hint}</span>}
    >
      <div className="rio:flex rio:min-h-8 rio:flex-wrap rio:items-center rio:gap-2">
        <input
          id={id}
          name={name}
          ref={inputRef}
          type="checkbox"
          checked={(value ?? inherited) === 'true'}
          className="rio:m-0 rio:size-4 rio:shrink-0 rio:accent-primary rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2"
          aria-describedby={hint ? `${id}-state ${id}-hint` : `${id}-state`}
          onChange={(event) =>
            form.change(name, String(event.currentTarget.checked), 'immediate')
          }
        />
        <span id={`${id}-state`} className={hintClass}>
          {inheritance}
        </span>
        {value !== undefined && (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${t('useInherited')}: ${t(name)}`}
            onClick={() => {
              form.change(name, '', 'immediate');
              inputRef.current?.focus();
            }}
          >
            {t('useInherited')}
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}
