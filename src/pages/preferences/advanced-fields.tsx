import * as React from 'react';
import {
  latencyRange,
  lineHeightRange,
  preferenceDefaults,
  scrollbackRange,
} from '../../preferences/values.ts';
import { ColorFields } from './color-fields.tsx';
import {
  ChoiceField,
  Disclosure,
  type FieldForm,
  TextField,
  ToggleField,
} from './fields.tsx';

function RenderingFields({ form }: { form: FieldForm }) {
  const { fields, base, t } = form;
  const canvas =
    (fields.renderer ?? base.renderer ?? preferenceDefaults.renderer) ===
    'canvas';
  const echo =
    (fields.predictiveEcho ??
      base.predictiveEcho ??
      String(preferenceDefaults.predictiveEcho)) === 'true';
  return (
    <section
      className="rio:grid rio:min-w-0 rio:gap-3"
      aria-label={t('rendering')}
    >
      <h4 className="rio:m-0 rio:text-sm rio:font-semibold">
        {t('rendering')}
      </h4>
      <ChoiceField
        form={form}
        name="renderer"
        options={['dom', 'canvas']}
        hint={t('rendererHint')}
      />
      {canvas && (
        <>
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
        </>
      )}
    </section>
  );
}

export function AdvancedFields({ form }: { form: FieldForm }) {
  const { t } = form;
  return (
    <Disclosure title={t('advanced')}>
      <section
        className="rio:grid rio:min-w-0 rio:gap-3"
        aria-label={t('layout')}
      >
        <h4 className="rio:m-0 rio:text-sm rio:font-semibold">{t('layout')}</h4>
        <TextField
          form={form}
          name="lineHeight"
          fallback={String(preferenceDefaults.lineHeight)}
          range={lineHeightRange}
        />
        <TextField
          form={form}
          name="scrollback"
          fallback={t('hostLimit')}
          range={scrollbackRange}
          hint={t('historyHint')}
        />
        <ToggleField form={form} name="altIsMeta" />
        <ToggleField form={form} name="detectUrls" />
        <ToggleField form={form} name="fit" hint={t('fitHint')} />
        <ToggleField form={form} name="autoFocus" hint={t('focusHint')} />
      </section>
      <RenderingFields form={form} />
      <ColorFields form={form} />
    </Disclosure>
  );
}
