import * as React from 'react';
import {
  fontSizeRange,
  type HostFonts,
  type RioOverrides,
  resolvePreferences,
} from '../../preferences/values.ts';
import { type FieldForm, hintClass, TextField } from './fields.tsx';

export function FontFields({
  form,
  hostFonts,
  preview,
}: {
  form: FieldForm;
  hostFonts: HostFonts;
  preview: RioOverrides;
}) {
  const { t } = form;
  const { fontFamily, fontSize } = resolvePreferences(preview, hostFonts, 0);
  const invalid =
    form.invalid.includes('fontFamily') || form.invalid.includes('fontSize');
  return (
    <section aria-label={t('fonts')} className="rio:grid rio:min-w-0 rio:gap-3">
      <div className="rio:grid rio:gap-1">
        <h4 className="rio:m-0 rio:text-base rio:font-semibold">
          {t('fonts')}
        </h4>
        <p className={hintClass}>{t('fontHelp')}</p>
      </div>
      <TextField
        form={form}
        name="fontFamily"
        fallback={hostFonts.fontFamily}
        hint={t('familyHint')}
      />
      <TextField
        form={form}
        name="fontSize"
        fallback={String(hostFonts.fontSize)}
        range={fontSizeRange}
      />
      <div className="rio:grid rio:min-w-0 rio:gap-1 rio:rounded-md rio:bg-muted rio:px-3 rio:py-2">
        <span className={hintClass}>{t('hostFont')}</span>
        <p className="rio:m-0 rio:text-sm rio:wrap-anywhere">
          <bdi>{hostFonts.fontFamily}</bdi> ·{' '}
          <span className="rio:whitespace-nowrap">{hostFonts.fontSize} px</span>
        </p>
        <span className={hintClass}>{t('fontPreview')}</span>
        {/* Only these two live values depend on validated font choices / the DSH font snapshot. The preview never applies styles to a real terminal. */}
        <p
          style={{ fontFamily, fontSize }}
          className="rio:m-0 rio:min-w-0 rio:max-w-full rio:overflow-hidden rio:leading-normal rio:wrap-anywhere"
        >
          {t('fontSample')}
        </p>
        {invalid && <p className={hintClass}>{t('fontFallback')}</p>}
      </div>
    </section>
  );
}
