import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import {
  ansiNames,
  colorFields,
  colorPattern,
} from '../../preferences/values.ts';
import {
  controlClass,
  Disclosure,
  type FieldForm,
  hintClass,
} from './fields.tsx';

type ColorName = (typeof colorFields)[number] | (typeof ansiNames)[number];

function expandHex(value: string | undefined): string | undefined {
  if (!value || !colorPattern.test(value)) return undefined;
  if (value.length > 5) return value;
  return `#${Array.from(value.slice(1), (digit) => digit + digit).join('')}`;
}

function ColorField({
  form,
  name,
  index,
}: {
  form: FieldForm;
  name: ColorName;
  index?: number;
}) {
  const { t, fields, base, change } = form;
  const id = React.useId();
  const label = index === undefined ? t(name) : `${index} · ${t(name)}`;
  const value = fields[name];
  const swatch = expandHex(value) ?? expandHex(base[name]);
  const alpha = swatch?.slice(7);
  const opacity =
    swatch === undefined
      ? undefined
      : Math.round((Number.parseInt(alpha || 'ff', 16) / 255) * 1000) / 10;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const invalid = form.invalid.includes(name);
  return (
    <div className="rio:grid rio:min-w-0 rio:gap-1">
      <div className="rio:flex rio:flex-wrap rio:items-baseline rio:justify-between rio:gap-x-2">
        <label className="rio:text-sm rio:font-medium" htmlFor={id}>
          {label}
        </label>
        {opacity !== undefined && (
          <span id={`${id}-opacity`} className={hintClass}>
            {t('opacity')}: {opacity}%
          </span>
        )}
      </div>
      <div className="rio:flex rio:min-w-0 rio:items-center rio:gap-2">
        <div className="rio:relative rio:size-9 rio:shrink-0">
          {/* A native picker needs a 6-digit seed. Do not display the UA seed as the theme or put it into the draft until a person picks a color. */}
          <input
            type="color"
            value={swatch?.slice(0, 7) ?? '#000000'}
            aria-label={`${t('chooseColor')}: ${label}`}
            title={`${t('chooseColor')}: ${label}`}
            aria-describedby={
              opacity === undefined ? undefined : `${id}-opacity`
            }
            className="rio:box-border rio:size-full rio:cursor-pointer rio:rounded-md rio:border rio:border-solid rio:border-border rio:bg-background rio:p-1 rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-1"
            onChange={(event) =>
              change(name, event.currentTarget.value + (alpha ?? ''))
            }
          />
          {!swatch && (
            <span
              aria-hidden="true"
              className="rio:pointer-events-none rio:absolute rio:inset-px rio:grid rio:place-items-center rio:rounded-md rio:bg-muted rio:text-foreground"
            >
              +
            </span>
          )}
        </div>
        <input
          type="text"
          name={name}
          id={id}
          dir="ltr"
          ref={inputRef}
          value={value ?? ''}
          placeholder={base[name] ?? t('inherited')}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className={controlClass}
          onChange={(event) => change(name, event.currentTarget.value)}
        />
        <Button
          size="sm"
          variant="outline"
          className="rio:shrink-0"
          disabled={value === undefined}
          aria-label={`${t('clear')}: ${label}`}
          onClick={() => {
            change(name, '');
            inputRef.current?.focus();
          }}
        >
          {t('clear')}
        </Button>
      </div>
      {invalid && (
        <p
          id={`${id}-error`}
          className="rio:m-0 rio:text-xs rio:text-destructive"
        >
          {t('invalidColor')}
        </p>
      )}
    </div>
  );
}

export function ColorFields({ form }: { form: FieldForm }) {
  const { t } = form;
  return (
    <Disclosure title={t('colors')}>
      <p className={hintClass}>{t('colorHint')}</p>
      <div className="rio:grid rio:min-w-0 rio:grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] rio:gap-3">
        {colorFields.map((name) => (
          <ColorField key={name} name={name} form={form} />
        ))}
      </div>
      <Disclosure title={t('palette')}>
        <div className="rio:grid rio:min-w-0 rio:grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] rio:gap-3">
          {ansiNames.map((name, index) => (
            <ColorField key={name} name={name} index={index} form={form} />
          ))}
        </div>
      </Disclosure>
    </Disclosure>
  );
}
