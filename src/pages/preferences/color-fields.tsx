import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import {
  ansiNames,
  ansiPresets,
  boldBrightModes,
  colorFields,
  colorPattern,
} from '../../preferences/values.ts';
import { defaultAnsiColor } from '../../rio/theme-defaults.ts';
import {
  ChoiceField,
  controlClass,
  Disclosure,
  type FieldForm,
  hintClass,
  PreferenceTextInput,
  SettingsSection,
  settingsButtonClass,
} from './fields.tsx';

type ColorName = (typeof colorFields)[number] | (typeof ansiNames)[number];

function expandHex(value: string | undefined): string | undefined {
  if (!value || !colorPattern.test(value)) return undefined;
  if (value.length > 5) return value;
  return `#${Array.from(value.slice(1), (digit) => digit + digit).join('')}`;
}

// Describe the color *after clearing this field*. A blank ANSI slot only
// inherits its own slot. Dynamic theme colors have a source, not a known hex.
function inheritedColor(form: FieldForm, name: ColorName) {
  const { base, fields, t } = form;
  if (base[name]) return { source: t('colorProfile'), hex: base[name] };
  switch (name) {
    case 'foreground':
      return { source: t('colorDshText') };
    case 'background':
      return { source: t('colorDshBackground') };
    case 'cursor': {
      const text = fields.foreground ?? base.foreground;
      return {
        source: t('colorCurrentText'),
        hex: text && colorPattern.test(text) ? text : undefined,
      };
    }
    case 'selectionForeground':
      return { source: t('colorSystemText') };
    case 'selectionBackground':
      return { source: t('colorSystemHighlight') };
    default: {
      const preset =
        (fields.ansiPreset ?? base.ansiPreset) === 'dsh' ? 'dsh' : 'rio';
      return {
        source: t(preset === 'rio' ? 'colorRioPalette' : 'dsh'),
        hex: defaultAnsiColor(name, preset),
      };
    }
  }
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
  const { t, fields, change } = form;
  const id = React.useId();
  const label = index === undefined ? t(name) : `${index} · ${t(name)}`;
  const value = fields[name];
  const fallback = form.sourcesReady ? inheritedColor(form, name) : undefined;
  const swatch = expandHex(value ?? fallback?.hex);
  const sourceId = `${id}-source`;
  const inherited = fallback
    ? `${t(value === undefined ? 'inherited' : 'ifCleared')}: ${fallback.source}${fallback.hex ? ` ${fallback.hex}` : ''}`
    : t('colorSourceUnavailable');
  const alpha = swatch?.slice(7);
  const opacity = alpha
    ? Math.round((Number.parseInt(alpha, 16) / 255) * 1000) / 10
    : undefined;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const invalid = form.invalid.includes(name);
  return (
    <div className="rio:grid rio:min-w-0 rio:gap-2">
      <div className="rio:flex rio:flex-wrap rio:items-baseline rio:justify-between rio:gap-x-2">
        <label
          className="rio:text-sm rio:font-normal rio:leading-[22px]"
          htmlFor={id}
        >
          {label}
        </label>
        {opacity !== undefined && (
          <span id={`${id}-opacity`} className={hintClass}>
            {t('opacity')}: {opacity}%
          </span>
        )}
      </div>
      <div className="rio:flex rio:min-w-0 rio:flex-wrap rio:items-center rio:gap-2">
        <div className="rio:relative rio:size-10 rio:shrink-0">
          {/* A native picker needs a 6-digit seed. Do not display the UA seed as the theme or put it into the draft until a person picks a color. */}
          <input
            type="color"
            value={swatch?.slice(0, 7) ?? '#000000'}
            aria-label={`${t('chooseColor')}: ${label}`}
            title={`${t('chooseColor')}: ${label}`}
            aria-describedby={
              opacity === undefined ? sourceId : `${sourceId} ${id}-opacity`
            }
            className="rio:box-border rio:size-full rio:cursor-pointer rio:rounded-settings rio:border rio:border-solid rio:border-border rio:bg-muted rio:p-1 rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-1"
            onChange={(event) =>
              change(
                name,
                event.currentTarget.value + (alpha ?? ''),
                'immediate',
              )
            }
          />
          {!swatch && (
            <span
              aria-hidden="true"
              className="rio:pointer-events-none rio:absolute rio:inset-px rio:grid rio:place-items-center rio:rounded-settings rio:bg-muted rio:text-foreground"
            >
              +
            </span>
          )}
        </div>
        <PreferenceTextInput
          form={form}
          name={name}
          id={id}
          dir="ltr"
          inputRef={inputRef}
          placeholder={fallback && (fallback.hex ?? t('defaultValue'))}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${sourceId} ${id}-error` : sourceId}
          className={cn(
            controlClass,
            'rio:w-auto rio:min-w-[min(100%,6rem)] rio:flex-1',
          )}
        />
        {value !== undefined && (
          <Button
            size="sm"
            variant="outline"
            className={cn(settingsButtonClass, 'rio:shrink-0')}
            aria-label={`${t('clear')}: ${label}`}
            onClick={() => {
              change(name, '', 'immediate');
              inputRef.current?.focus();
            }}
          >
            {t('clear')}
          </Button>
        )}
      </div>
      <p id={sourceId} className="rio:sr-only">
        {value !== undefined && `${t('colorOverride')} · `}
        {inherited}
      </p>
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
    <SettingsSection title={t('colors')}>
      <section
        aria-label={t('textAndBackground')}
        className="rio:grid rio:min-w-0 rio:grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] rio:gap-6 rio:py-3"
      >
        <ColorField name="foreground" form={form} />
        <ColorField name="background" form={form} />
      </section>
      <ChoiceField
        form={form}
        name="ansiPreset"
        options={ansiPresets}
        hint={t('ansiHint')}
      />
      {form.sourcesReady && (
        <div
          role="img"
          aria-label={t('previewColors')}
          className="rio:flex rio:min-w-0 rio:overflow-hidden rio:rounded-sm"
        >
          {ansiNames.map((name) => {
            const color = expandHex(
              form.fields[name] ?? inheritedColor(form, name).hex,
            );
            return (
              <span
                key={name}
                title={`${t(name)}: ${color ?? t('invalidColor')}`}
                className="rio:h-2 rio:flex-1"
                style={{ backgroundColor: color }}
              />
            );
          })}
        </div>
      )}
      <ChoiceField
        form={form}
        name="boldBright"
        options={boldBrightModes}
        hint={t('boldBrightHint')}
      />
      <Disclosure title={t('baseColors')}>
        <p className={hintClass}>{t('colorHint')}</p>
        <div className="rio:grid rio:min-w-0 rio:grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] rio:gap-x-6 rio:gap-y-6">
          {colorFields
            .filter((name) => name !== 'foreground' && name !== 'background')
            .map((name) => (
              <ColorField key={name} name={name} form={form} />
            ))}
        </div>
      </Disclosure>
      <Disclosure title={t('palette')}>
        <div className="rio:grid rio:min-w-0 rio:grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] rio:gap-x-6 rio:gap-y-6">
          {ansiNames.map((name, index) => (
            <ColorField key={name} name={name} index={index} form={form} />
          ))}
        </div>
      </Disclosure>
    </SettingsSection>
  );
}
