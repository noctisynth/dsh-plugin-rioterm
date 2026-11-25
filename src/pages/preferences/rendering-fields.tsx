import * as React from 'react';
import { latencyRange, preferenceDefaults } from '../../preferences/values.ts';
import {
  ChoiceField,
  Disclosure,
  type FieldForm,
  SettingsSection,
  TextField,
  ToggleField,
} from './fields.tsx';

export function RenderingFields({ form }: { form: FieldForm }) {
  const { fields, base, t } = form;
  const canvas =
    (fields.renderer ?? base.renderer ?? preferenceDefaults.renderer) ===
    'canvas';
  const echo =
    (fields.predictiveEcho ??
      base.predictiveEcho ??
      String(preferenceDefaults.predictiveEcho)) === 'true';
  return (
    <SettingsSection title={t('rendering')}>
      <ChoiceField
        form={form}
        name="renderer"
        options={['dom', 'canvas']}
        hint={t('rendererHint')}
      />
      {canvas && (
        <Disclosure
          title={t('canvasControls')}
          description={t('renderingDescription')}
        >
          <ChoiceField
            form={form}
            name="cursorStyle"
            options={['block', 'bar', 'underline']}
          />
          <ToggleField form={form} name="predictiveEcho" hint={t('echoHint')} />
          {echo && (
            <>
              <TextField
                form={form}
                name="latencyThreshold"
                fallback={String(preferenceDefaults.latencyThreshold)}
                range={latencyRange}
              />
              <ChoiceField
                form={form}
                name="predictionStyle"
                options={['underline', 'dim']}
              />
            </>
          )}
        </Disclosure>
      )}
    </SettingsSection>
  );
}
