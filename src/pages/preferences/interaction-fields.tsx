import * as React from 'react';
import { scrollbackRange } from '../../preferences/values.ts';
import {
  type FieldForm,
  SettingsSection,
  TextField,
  ToggleField,
} from './fields.tsx';

export function InteractionFields({ form }: { form: FieldForm }) {
  const { t } = form;
  return (
    <SettingsSection
      title={t('interaction')}
      description={t('interactionDescription')}
    >
      <TextField
        form={form}
        name="scrollback"
        fallback={t('hostLimit')}
        range={scrollbackRange}
        hint={t('historyHint')}
      />
      <ToggleField form={form} name="altIsMeta" />
      <ToggleField form={form} name="detectUrls" />
      <ToggleField form={form} name="autoFocus" hint={t('focusHint')} />
    </SettingsSection>
  );
}
