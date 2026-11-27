import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import type { PreferenceTranslate } from './messages.ts';

type ScreenPicker = new () => {
  open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }>;
};

/** A user-initiated, cancellable enhancement; never sample the screen on mount. */
export function ColorPickerEyeDropper({
  disabled,
  t,
  onPick,
  onActiveChange,
}: {
  disabled: boolean;
  t: PreferenceTranslate;
  onPick(hex: string): void;
  onActiveChange(active: boolean): void;
}) {
  const Picker =
    typeof window === 'undefined'
      ? undefined
      : (window as typeof window & { EyeDropper?: ScreenPicker }).EyeDropper;
  const request = React.useRef<AbortController>();
  const latest = React.useRef({ disabled, onPick, onActiveChange });
  latest.current = { disabled, onPick, onActiveChange };
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  React.useEffect(
    () => () => {
      const active = request.current;
      request.current = undefined;
      active?.abort();
      if (active) latest.current.onActiveChange(false);
    },
    [],
  );
  React.useEffect(() => {
    if (!disabled || !request.current) return;
    const active = request.current;
    request.current = undefined;
    active.abort();
    setBusy(false);
    latest.current.onActiveChange(false);
  }, [disabled]);
  if (!Picker) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-slot="color-picker-eyedropper"
        className="rio:justify-start rio:gap-2 rio:rounded-settings"
        disabled={disabled || busy}
        onClick={async () => {
          if (latest.current.disabled || request.current) return;
          const controller = new AbortController();
          request.current = controller;
          setError(false);
          setBusy(true);
          latest.current.onActiveChange(true);
          try {
            // Call directly from the click, while the browser's user activation is live.
            const result = await new Picker().open({
              signal: controller.signal,
            });
            if (
              request.current !== controller ||
              controller.signal.aborted ||
              latest.current.disabled
            )
              return;
            if (
              result.sRGBHex.length !== 7 ||
              !/^#[\da-f]{6}$/i.test(result.sRGBHex)
            )
              throw new Error('Invalid screen color');
            latest.current.onPick(result.sRGBHex);
          } catch (cause) {
            if (
              request.current === controller &&
              !controller.signal.aborted &&
              !(cause instanceof Error && cause.name === 'AbortError')
            )
              setError(true);
          } finally {
            if (request.current === controller) {
              request.current = undefined;
              setBusy(false);
              latest.current.onActiveChange(false);
            }
          }
        }}
      >
        <svg
          aria-hidden="true"
          className="rio:size-4 rio:shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m16 3 5 5-3 3-5-5 3-3ZM14 7 4 17v3h3L17 10M3 21l1-1" />
        </svg>
        {t('pickerEyeDropper')}
      </Button>
      {error && (
        <p role="status" className="rio:m-0 rio:text-xs rio:text-destructive">
          {t('pickerEyeDropperError')}
        </p>
      )}
    </>
  );
}
