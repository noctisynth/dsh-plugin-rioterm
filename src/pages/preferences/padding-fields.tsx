import * as React from 'react';
import {
  paddingFields,
  paddingRange,
  preferenceDefaults,
} from '../../preferences/values.ts';
import {
  controlClass,
  type FieldForm,
  hintClass,
  PreferenceTextInput,
  SettingsRow,
} from './fields.tsx';

const sideLabels = {
  paddingTop: 'top',
  paddingRight: 'right',
  paddingBottom: 'bottom',
  paddingLeft: 'left',
} as const;

export function PaddingFields({ form }: { form: FieldForm }) {
  const { t } = form;
  const id = React.useId();
  const hintId = `${id}-hint`;
  return (
    <SettingsRow
      label={<span id={id}>{t('padding')}</span>}
      description={
        <span id={hintId}>
          {t('paddingHelp')} {t('integerRange')}: {paddingRange.join('–')} px.
        </span>
      }
    >
      <fieldset
        aria-labelledby={id}
        className="rio:m-0 rio:grid rio:min-w-0 rio:grid-cols-[repeat(auto-fit,minmax(min(100%,3.25rem),1fr))] rio:gap-1.5 rio:border-0 rio:p-0"
      >
        {paddingFields.map((name) => (
          <div key={name} className="rio:grid rio:min-w-0 rio:gap-0.5">
            <label htmlFor={`${id}-${name}`} className={hintClass}>
              {t(sideLabels[name])}
            </label>
            <PreferenceTextInput
              form={form}
              id={`${id}-${name}`}
              name={name}
              placeholder={form.base[name] ?? String(preferenceDefaults[name])}
              inputMode="numeric"
              autoComplete="off"
              aria-label={t(name)}
              aria-describedby={hintId}
              aria-invalid={form.invalid.includes(name) || undefined}
              className={controlClass}
            />
          </div>
        ))}
      </fieldset>
    </SettingsRow>
  );
}
