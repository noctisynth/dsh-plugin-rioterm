import * as React from 'react';
import {
  paddingFields,
  paddingRange,
  preferenceDefaults,
} from '../../preferences/values.ts';
import { type FieldForm, hintClass, TextField } from './fields.tsx';

export function PaddingFields({ form }: { form: FieldForm }) {
  const { t } = form;
  const hintId = React.useId();
  return (
    <section
      aria-label={t('padding')}
      className="rio:grid rio:min-w-0 rio:gap-3"
    >
      <div className="rio:grid rio:gap-1">
        <h4 className="rio:m-0 rio:text-base rio:font-semibold">
          {t('padding')}
        </h4>
        <p id={hintId} className={hintClass}>
          {t('paddingHelp')} {t('integerRange')}: {paddingRange.join('–')}.
        </p>
      </div>
      <div className="rio:grid rio:min-w-0 rio:max-w-2xl rio:grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] rio:gap-3">
        {paddingFields.map((name) => (
          <TextField
            key={name}
            form={form}
            name={name}
            fallback={String(preferenceDefaults[name])}
            range={paddingRange}
            sharedRangeHintId={hintId}
          />
        ))}
      </div>
    </section>
  );
}
