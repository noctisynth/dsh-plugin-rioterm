import * as React from 'react';
import { cn } from '../../lib/cn.ts';
import {
  ansiNames,
  ansiPresets,
  boldBrightModes,
  colorFields,
  colorPattern,
} from '../../preferences/values.ts';
import { defaultAnsiColor, usesBoldBright } from '../../rio/theme-defaults.ts';
import { ColorPicker } from './color-picker.tsx';
import { FieldResetAction } from './field-reset-action.tsx';
import {
  ChoiceField,
  controlClass,
  Disclosure,
  type FieldForm,
  hintClass,
  PreferenceTextInput,
  SettingsSection,
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
        <div className="rio:flex rio:min-w-0 rio:flex-wrap rio:items-baseline rio:gap-x-2">
          <label
            className="rio:text-sm rio:font-normal rio:leading-[22px]"
            htmlFor={id}
          >
            {label}
          </label>
          <FieldResetAction
            form={form}
            names={[name]}
            label={label}
            onResetFocus={() => inputRef.current?.focus()}
          />
        </div>
        {opacity !== undefined && (
          <span id={`${id}-opacity`} className={hintClass}>
            {t('opacity')}: {opacity}%
          </span>
        )}
      </div>
      <div className="rio:flex rio:min-w-0 rio:flex-wrap rio:items-center rio:gap-2">
        <ColorPicker
          value={swatch}
          disabled={!form.writable}
          label={label}
          describedBy={
            opacity === undefined ? sourceId : `${sourceId} ${id}-opacity`
          }
          t={t}
          onValueChange={(color) => {
            if (form.writable) change(name, color, 'immediate');
          }}
        />
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

// These CSS fallbacks match the renderer without mounting a terminal or resolving
// the host's dynamic colors into persisted preferences.
const previewDefaults = {
  foreground: 'var(--dsw-alias-label-primary, CanvasText)',
  background: 'var(--dsw-alias-bg-base, Canvas)',
  cursor: 'currentColor',
  selectionForeground: 'HighlightText',
  selectionBackground: 'Highlight',
};

function ColorPreview({ form }: { form: FieldForm }) {
  const { fields, base, t } = form;
  if (!form.sourcesReady) return null;
  const ansiPreset =
    (fields.ansiPreset ?? base.ansiPreset) === 'dsh' ? 'dsh' : 'rio';
  const boldBright = fields.boldBright ?? base.boldBright;
  const bright = usesBoldBright({
    ansiPreset,
    boldBright:
      boldBright === 'always' || boldBright === 'never' ? boldBright : 'auto',
  });
  const color = (name: ColorName): string =>
    expandHex(fields[name]) ??
    expandHex(base[name]) ??
    (name in previewDefaults
      ? previewDefaults[name as keyof typeof previewDefaults]
      : (expandHex(
          defaultAnsiColor(name as (typeof ansiNames)[number], ansiPreset),
        ) ?? previewDefaults.foreground));
  const invalid = [...colorFields, ...ansiNames].some(
    (name) => fields[name] !== undefined && !expandHex(fields[name]),
  );
  return (
    <figure
      data-rio-preview="color"
      aria-label={t('colorPreview')}
      className="rio:m-0 rio:grid rio:w-full rio:min-w-0 rio:gap-2 rio:py-2"
    >
      <figcaption className={hintClass}>{t('colorPreview')}</figcaption>
      <div
        className="rio:grid rio:min-w-0 rio:gap-2 rio:rounded-settings rio:border rio:border-solid rio:border-border rio:p-3 rio:font-mono rio:text-sm rio:leading-relaxed rio:wrap-anywhere"
        style={{
          color: color('foreground'),
          backgroundColor: color('background'),
        }}
      >
        <div>{t('colorSample')}</div>
        <div className="rio:flex rio:flex-wrap rio:gap-x-3 rio:gap-y-1">
          {ansiNames.slice(0, 8).map((name) => (
            <span key={name} style={{ color: color(name) }}>
              {t(name)}
            </span>
          ))}
        </div>
        <div className="rio:flex rio:flex-wrap rio:items-center rio:gap-3">
          <strong style={{ color: color(bright ? 'brightBlue' : 'blue') }}>
            {t('boldSample')}
          </strong>
          <span
            style={{
              color: color('selectionForeground'),
              backgroundColor: color('selectionBackground'),
            }}
          >
            {t('selectionSample')}
          </span>
          <span
            aria-hidden="true"
            className="rio:inline-block rio:h-4 rio:w-2"
            style={{ backgroundColor: color('cursor') }}
          />
        </div>
      </div>
      <div
        role="img"
        aria-label={t('previewColors')}
        className="rio:flex rio:min-w-0 rio:overflow-hidden rio:rounded-sm"
      >
        {ansiNames.map((name) => (
          <span
            key={name}
            title={`${t(name)}: ${color(name)}`}
            className="rio:h-2 rio:flex-1"
            style={{ backgroundColor: color(name) }}
          />
        ))}
      </div>
      {invalid && <p className={hintClass}>{t('colorPreviewFallback')}</p>}
    </figure>
  );
}

export function ColorFields({ form }: { form: FieldForm }) {
  const { t } = form;
  return (
    <SettingsSection
      title={t('colors')}
      description={t('colorSummary')}
      preview={<ColorPreview form={form} />}
    >
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
