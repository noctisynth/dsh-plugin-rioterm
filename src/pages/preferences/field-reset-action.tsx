import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import type { Field } from './draft.ts';
import type { FieldForm } from './fields.tsx';

/** A field-label action, never part of the label's activation target. */
export function FieldResetAction({
  form,
  names,
  label,
  onResetFocus,
}: {
  form: Pick<FieldForm, 'fields' | 'writable' | 'change' | 't'>;
  names: readonly Field[];
  label: string;
  onResetFocus(): void;
}): React.ReactElement | null {
  const overridden = names.filter((name) => form.fields[name] !== undefined);
  if (!overridden.length) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-slot="field-reset"
      disabled={!form.writable}
      aria-label={`${form.t('useInherited')}: ${label}`}
      className="rio:min-h-6 rio:shrink-0 rio:gap-1 rio:rounded-sm rio:border-0 rio:bg-transparent rio:px-1 rio:py-0 rio:text-xs rio:font-normal rio:text-settings-action rio:whitespace-nowrap rio:hover:bg-transparent rio:hover:text-foreground rio:focus-visible:text-foreground"
      onClick={() => {
        if (!form.writable) return;
        for (const name of overridden) form.change(name, '', 'immediate');
        onResetFocus();
      }}
    >
      <span>{form.t('useInherited')}</span>
      <svg
        aria-hidden="true"
        className="rio:size-3.5 rio:shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </Button>
  );
}
