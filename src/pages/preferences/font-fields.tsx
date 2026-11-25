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
  SettingsRow,
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
    <SettingsSection title={t('fontLayout')} description={t('fontHelp')}>
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
      <SettingsRow
        label={t('fontPreview')}
        description={
          <>
            {t('hostFont')}: <bdi>{hostFonts.fontFamily}</bdi> ·{' '}
            <span className="rio:whitespace-nowrap">
              {hostFonts.fontSize} px
            </span>
          </>
        }
      >
        {/* Only the sample uses live font values. Never apply a draft to a real terminal. */}
        <p
          style={{ fontFamily, fontSize }}
          className="rio:m-0 rio:min-w-0 rio:max-w-full rio:overflow-hidden rio:rounded-md rio:bg-muted rio:px-2.5 rio:py-1 rio:leading-normal rio:wrap-anywhere"
        >
          {t('fontSample')}
        </p>
        {invalid && <p className={hintClass}>{t('fontFallback')}</p>}
      </SettingsRow>
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
