import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import {
  preferenceDefaults,
  type RioPreferenceValues,
} from '../../preferences/values.ts';
import type { Field, Fields } from './draft.ts';
import type { PreferenceTranslate } from './messages.ts';

export interface FieldForm {
  fields: Fields;
  base: Fields;
  invalid: readonly Field[];
  change(key: Field, text: string): void;
  t: PreferenceTranslate;
}

export const controlClass =
  'rio:box-border rio:block rio:min-h-9 rio:w-full rio:min-w-0 rio:max-w-full rio:rounded-md rio:border rio:border-solid rio:border-border rio:bg-background rio:px-2.5 rio:py-1.5 rio:[font-family:inherit] rio:text-sm rio:text-foreground rio:placeholder:text-muted-foreground rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-1 rio:aria-invalid:border-destructive rio:disabled:opacity-60';
export const hintClass =
  'rio:m-0 rio:text-xs rio:leading-relaxed rio:text-muted-foreground rio:wrap-anywhere';

export function Disclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rio:min-w-0 rio:rounded-md rio:border rio:border-solid rio:border-border rio:bg-background">
      <summary className="rio:cursor-pointer rio:rounded-md rio:px-3 rio:py-2.5 rio:text-sm rio:font-medium rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:-outline-offset-2">
        {title}
      </summary>
      <div className="rio:grid rio:min-w-0 rio:gap-4 rio:px-3 rio:pb-3">
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
    <div className="rio:grid rio:min-w-0 rio:content-start rio:gap-1">
      <label htmlFor={id} className="rio:text-sm rio:font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      )}
    </div>
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
  const { fields, base, t } = form;
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
      <input
        id={id}
        type="text"
        name={name}
        value={fields[name] ?? ''}
        placeholder={base[name] ?? fallback}
        inputMode={range ? (decimal ? 'decimal' : 'numeric') : 'text'}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={description ? `${id}-hint` : undefined}
        className={cn(controlClass, range && 'rio:max-w-40')}
        onChange={(event) => form.change(name, event.currentTarget.value)}
      />
    </LabeledField>
  );
}

type ChoiceName = 'renderer' | 'cursorStyle' | 'predictionStyle';
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
  return (
    <LabeledField id={id} label={t(name)} hint={hint}>
      <select
        id={id}
        name={name}
        className={controlClass}
        value={fields[name] ?? ''}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => form.change(name, event.currentTarget.value)}
      >
        <option value="">
          {t('inherited')}: {t(inherited)}
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
  const inheritance = `${t(value === undefined ? 'inherited' : 'ifCleared')}: ${t(inherited === 'true' ? 'on' : 'off')}`;
  return (
    <div className="rio:grid rio:min-w-0 rio:gap-1">
      <div className="rio:flex rio:min-h-7 rio:flex-wrap rio:items-center rio:justify-between rio:gap-x-3 rio:gap-y-1">
        <label
          htmlFor={id}
          className="rio:inline-flex rio:min-w-0 rio:cursor-pointer rio:items-center rio:gap-2 rio:text-sm rio:font-medium"
        >
          <input
            id={id}
            name={name}
            ref={inputRef}
            type="checkbox"
            checked={(value ?? inherited) === 'true'}
            className="rio:m-0 rio:size-4 rio:shrink-0 rio:accent-primary rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2"
            aria-describedby={hint ? `${id}-state ${id}-hint` : `${id}-state`}
            onChange={(event) =>
              form.change(name, String(event.currentTarget.checked))
            }
          />
          {t(name)}
        </label>
        <div className="rio:flex rio:flex-wrap rio:items-center rio:gap-2">
          <span id={`${id}-state`} className={hintClass}>
            {inheritance}
          </span>
          {value !== undefined && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`${t('useInherited')}: ${t(name)}`}
              onClick={() => {
                form.change(name, '');
                inputRef.current?.focus();
              }}
            >
              {t('useInherited')}
            </Button>
          )}
        </div>
      </div>
      {hint && (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      )}
    </div>
  );
}
