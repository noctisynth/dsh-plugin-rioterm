import * as React from 'react';
import {
  fontSizeRange,
  type HostFonts,
  lineHeightRange,
  preferenceDefaults,
  type RioOverrides,
  resolvePreferences,
} from '../../preferences/values.ts';
import {
  type FieldForm,
  hintClass,
  SettingsSection,
  TextField,
  ToggleField,
} from './fields.tsx';
import { PaddingFields } from './padding-fields.tsx';

export function FontLayoutFields({
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
    <SettingsSection
      title={t('fontLayout')}
      description={t('fontHelp')}
      preview={
        <figure
          data-rio-preview="font"
          aria-label={t('fontPreview')}
          className="rio:m-0 rio:grid rio:w-full rio:min-w-0 rio:gap-2 rio:py-2"
        >
          <figcaption className={hintClass}>{t('fontPreview')}</figcaption>
          {/* This read-only sample never mounts a terminal or writes settings. */}
          <p
            style={{ fontFamily, fontSize }}
            className="rio:box-border rio:m-0 rio:w-full rio:min-w-0 rio:max-w-full rio:overflow-hidden rio:rounded-settings rio:bg-muted rio:px-4 rio:py-3 rio:leading-normal rio:wrap-anywhere"
          >
            {t('fontSample')}
          </p>
          {invalid && <p className={hintClass}>{t('fontFallback')}</p>}
        </figure>
      }
    >
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
      <PaddingFields form={form} />
      <TextField
        form={form}
        name="lineHeight"
        fallback={String(preferenceDefaults.lineHeight)}
        range={lineHeightRange}
      />
      <ToggleField form={form} name="fit" hint={t('fitHint')} />
    </SettingsSection>
  );
}
