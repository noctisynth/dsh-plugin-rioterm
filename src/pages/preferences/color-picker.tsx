import * as React from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';
import { ColorPickerEyeDropper } from './color-picker-eyedropper.tsx';
import {
  alphaPercent,
  clamp,
  hsvToRgb,
  type PickerHsv,
  type PickerRgba,
  parseHex,
  rgbaToHex,
  rgbToHsv,
  withAlphaPercent,
} from './color-picker-model.ts';
import type { PreferenceTranslate } from './messages.ts';

type Channel = 'r' | 'g' | 'b';
const invalidChannel = (text: string) =>
  text === '' ||
  !Number.isInteger(Number(text)) ||
  Number(text) < 0 ||
  Number(text) > 255;
type PickerState = {
  rgba: PickerRgba;
  hsv: PickerHsv;
  hex: string;
  rgb: Record<Channel, string>;
};

function stateFor(color: PickerRgba | undefined, hue = 0): PickerState {
  // An editing seed is not a resolved inherited color and is never emitted on open.
  const rgba = color ?? { r: 255, g: 255, b: 255, a: 255, hasAlpha: false };
  return {
    rgba,
    hsv: rgbToHsv(rgba, hue),
    hex: color ? rgbaToHex(color) : '',
    rgb: { r: String(rgba.r), g: String(rgba.g), b: String(rgba.b) },
  };
}

export function ColorPicker({
  value,
  disabled,
  label,
  describedBy,
  onValueChange,
  t,
}: {
  value?: string | undefined;
  disabled: boolean;
  label: string;
  describedBy?: string | undefined;
  onValueChange(value: string): void;
  t: PreferenceTranslate;
}) {
  const parsed = parseHex(value);
  const validValue = parsed ? rgbaToHex(parsed) : undefined;
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState(() => stateFor(parsed));
  const stateRef = React.useRef(state);
  const openRef = React.useRef(false);
  const disabledRef = React.useRef(disabled);
  const mountedRef = React.useRef(false);
  const emittedRef = React.useRef<string | undefined>(undefined);
  const hexDirtyRef = React.useRef(false);
  const escapeRef = React.useRef(false);
  const pickingRef = React.useRef(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const pointerRef = React.useRef<number | undefined>(undefined);
  const id = React.useId();
  stateRef.current = state;
  disabledRef.current = disabled;

  React.useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRef.current = false;
      pointerRef.current = undefined;
    };
  }, []);

  React.useLayoutEffect(() => {
    if (!disabled) return;
    hexDirtyRef.current = false;
    openRef.current = false;
    pointerRef.current = undefined;
    setOpen(false);
  }, [disabled]);

  React.useLayoutEffect(() => {
    // Keep HSV precision, and the user's hue/saturation at black or gray, when
    // the parent echoes our own RGB conversion. External edits still synchronize.
    if (validValue !== undefined && validValue === emittedRef.current) {
      emittedRef.current = undefined;
      return;
    }
    emittedRef.current = undefined;
    hexDirtyRef.current = false;
    const next = stateFor(parseHex(validValue), stateRef.current.hsv.h);
    stateRef.current = next;
    setState(next);
  }, [validValue]);

  const editable = () =>
    mountedRef.current && openRef.current && !disabledRef.current;
  const update = (next: PickerState) => {
    stateRef.current = next;
    setState(next);
  };
  const choose = (
    rgba: PickerRgba,
    hsv = rgbToHsv(rgba, stateRef.current.hsv.h),
  ) => {
    if (!editable()) return;
    const hex = rgbaToHex(rgba);
    hexDirtyRef.current = false;
    update({ ...stateFor(rgba), hsv });
    emittedRef.current = hex;
    onValueChange(hex);
  };
  const chooseHsv = (patch: Partial<PickerHsv>) => {
    if (!editable()) return;
    const current = stateRef.current;
    const hsv = { ...current.hsv, ...patch };
    choose({ ...current.rgba, ...hsvToRgb(hsv) }, hsv);
  };
  const changeOpen = (next: boolean) => {
    if (!mountedRef.current) return;
    const allowed = next && !disabledRef.current;
    if (allowed) {
      escapeRef.current = false;
      hexDirtyRef.current = false;
      update(stateFor(parseHex(validValue), stateRef.current.hsv.h));
    } else {
      // A deliberate close accepts a complete draft, but Escape, read-only
      // transitions and unmount never commit. Do this before marking closed.
      if (!escapeRef.current) commitHex();
      pointerRef.current = undefined;
      hexDirtyRef.current = false;
    }
    openRef.current = allowed;
    setOpen(allowed);
  };
  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editable()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    chooseHsv({
      s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1),
    });
  };
  const commitHex = () => {
    if (!editable() || !hexDirtyRef.current || escapeRef.current) return;
    const color = parseHex(stateRef.current.hex);
    if (color) choose(color);
  };
  const opacity = alphaPercent(state.rgba.a);
  const saturation = Math.round(state.hsv.s * 100);
  const brightness = Math.round(state.hsv.v * 100);
  const hexInvalid =
    (hexDirtyRef.current || state.hex !== '') && !parseHex(state.hex);

  return (
    <Popover modal={true} open={open && !disabled} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={null}
          size={null}
          disabled={disabled}
          data-slot="color-picker-trigger"
          data-color={validValue}
          value={validValue ?? ''}
          aria-label={`${t('chooseColor')}: ${label}`}
          title={`${t('chooseColor')}: ${label}`}
          aria-describedby={describedBy}
          className="rio:size-10 rio:min-h-10 rio:shrink-0 rio:rounded-settings rio:border-border rio:bg-muted rio:p-1 rio:text-foreground"
        >
          {validValue ? (
            <span
              data-rio-color-checkerboard=""
              className="rio:block rio:size-full rio:overflow-hidden rio:rounded-settings"
            >
              <span
                aria-hidden="true"
                className="rio:block rio:size-full rio:rounded-settings"
                style={{ backgroundColor: validValue }}
              />
            </span>
          ) : (
            <span aria-hidden="true">+</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panelRef.current?.focus();
        }}
        onFocusOutside={(event) => {
          if (pickingRef.current) event.preventDefault();
        }}
        onEscapeKeyDown={() => {
          escapeRef.current = true;
        }}
        aria-labelledby={`${id}-title`}
        aria-describedby={!validValue ? `${id}-unknown` : undefined}
        className="rio:grid rio:w-[min(20rem,calc(100vw-2rem))] rio:gap-3 rio:p-3"
      >
        <div className="rio:flex rio:items-center rio:justify-between rio:gap-2">
          <span id={`${id}-title`} className="rio:text-sm rio:font-medium">
            {label}
          </span>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="sm"
              data-slot="color-picker-close"
              className="rio:rounded-settings"
              aria-label={t('pickerClose')}
              title={t('pickerClose')}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </PopoverClose>
        </div>
        <ColorPickerEyeDropper
          disabled={disabled || !open}
          t={t}
          onActiveChange={(active) => {
            pickingRef.current = active;
          }}
          onPick={(hex) => {
            const picked = parseHex(hex);
            if (!picked || !editable()) return;
            choose({
              ...stateRef.current.rgba,
              r: picked.r,
              g: picked.g,
              b: picked.b,
            });
          }}
        />
        {!validValue && (
          <p
            id={`${id}-unknown`}
            className="rio:m-0 rio:text-xs rio:text-muted-foreground"
          >
            {t('pickerUnknown')}
          </p>
        )}
        <div
          ref={panelRef}
          data-rio-color-sv=""
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${t('pickerSaturation')} / ${t('pickerBrightness')}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={saturation}
          aria-valuetext={`${t('pickerSaturation')}: ${saturation}%; ${t('pickerBrightness')}: ${brightness}%`}
          aria-describedby={`${id}-keyboard`}
          aria-disabled={disabled}
          className="rio:relative rio:box-border rio:h-40 rio:w-full rio:touch-none rio:cursor-crosshair rio:overflow-hidden rio:rounded-settings rio:border rio:border-solid rio:border-border rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2"
          style={{
            backgroundColor: `hsl(${clamp(state.hsv.h, 0, 360)} 100% 50%)`,
          }}
          onPointerDown={(event) => {
            if (!editable() || event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.focus();
            pointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            selectPoint(event);
          }}
          onPointerMove={(event) => {
            if (pointerRef.current === event.pointerId) selectPoint(event);
          }}
          onPointerUp={(event) => {
            if (pointerRef.current !== event.pointerId) return;
            selectPoint(event);
            pointerRef.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            pointerRef.current = undefined;
          }}
          onLostPointerCapture={() => {
            pointerRef.current = undefined;
          }}
          onKeyDown={(event) => {
            if (!editable()) return;
            const step = event.shiftKey ? 0.1 : 0.01;
            const current = stateRef.current.hsv;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              chooseHsv({
                s: clamp(
                  current.s + (event.key === 'ArrowRight' ? step : -step),
                  0,
                  1,
                ),
              });
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              chooseHsv({
                v: clamp(
                  current.v + (event.key === 'ArrowUp' ? step : -step),
                  0,
                  1,
                ),
              });
            }
          }}
        >
          <span
            aria-hidden="true"
            className="rio:pointer-events-none rio:absolute rio:size-3 rio:-translate-x-1/2 rio:-translate-y-1/2 rio:rounded-settings rio:border-2 rio:border-solid rio:border-white rio:shadow-sm"
            style={{
              left: `${clamp(state.hsv.s, 0, 1) * 100}%`,
              top: `${(1 - clamp(state.hsv.v, 0, 1)) * 100}%`,
            }}
          />
        </div>
        <p id={`${id}-keyboard`} className="rio:sr-only">
          {t('pickerKeyboard')}
        </p>
        <label className="rio:grid rio:gap-1 rio:text-xs" htmlFor={`${id}-hue`}>
          <span>{t('pickerHue')}</span>
          <input
            id={`${id}-hue`}
            data-rio-color-slider="hue"
            type="range"
            min={0}
            max={360}
            step={1}
            value={state.hsv.h}
            disabled={disabled}
            aria-valuetext={`${Math.round(state.hsv.h)}°`}
            className="rio:m-0 rio:h-10 rio:w-full rio:min-w-0 rio:rounded-settings"
            onChange={(event) => {
              chooseHsv({
                h: clamp(event.currentTarget.valueAsNumber, 0, 360),
              });
            }}
          />
        </label>
        <label
          className="rio:grid rio:gap-1 rio:text-xs"
          htmlFor={`${id}-alpha`}
        >
          <span>
            {t('pickerAlpha')}: {opacity}%
          </span>
          <input
            id={`${id}-alpha`}
            data-rio-color-slider="alpha"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={opacity}
            disabled={disabled}
            aria-valuetext={`${opacity}%`}
            className="rio:m-0 rio:h-10 rio:w-full rio:min-w-0 rio:rounded-settings"
            style={{
              color: rgbaToHex({ ...state.rgba, a: 255, hasAlpha: false }),
            }}
            onChange={(event) => {
              choose(
                withAlphaPercent(
                  stateRef.current.rgba,
                  event.currentTarget.valueAsNumber,
                ),
                stateRef.current.hsv,
              );
            }}
          />
        </label>
        <div className="rio:grid rio:grid-cols-3 rio:gap-2">
          {(['r', 'g', 'b'] as const).map((channel) => (
            <label
              key={channel}
              htmlFor={`${id}-${channel}`}
              className="rio:grid rio:min-w-0 rio:gap-1 rio:text-xs"
            >
              <span>
                {t(
                  channel === 'r'
                    ? 'pickerRed'
                    : channel === 'g'
                      ? 'pickerGreen'
                      : 'pickerBlue',
                )}
              </span>
              <Input
                id={`${id}-${channel}`}
                type="number"
                min={0}
                max={255}
                step={1}
                disabled={disabled}
                value={state.rgb[channel]}
                aria-invalid={invalidChannel(state.rgb[channel]) || undefined}
                aria-describedby={
                  invalidChannel(state.rgb[channel])
                    ? `${id}-rgb-error`
                    : undefined
                }
                className="rio:h-10 rio:rounded-settings rio:px-2 rio:aria-invalid:border-destructive"
                onChange={(event) => {
                  if (!editable()) return;
                  const draft = event.currentTarget.value;
                  const number = event.currentTarget.valueAsNumber;
                  if (
                    draft !== '' &&
                    Number.isInteger(number) &&
                    number >= 0 &&
                    number <= 255
                  ) {
                    choose({ ...stateRef.current.rgba, [channel]: number });
                  } else {
                    update({
                      ...stateRef.current,
                      rgb: { ...stateRef.current.rgb, [channel]: draft },
                    });
                  }
                }}
                onBlur={() => {
                  if (!editable()) return;
                  update({
                    ...stateRef.current,
                    rgb: {
                      ...stateRef.current.rgb,
                      [channel]: String(stateRef.current.rgba[channel]),
                    },
                  });
                }}
              />
            </label>
          ))}
        </div>
        {Object.values(state.rgb).some(invalidChannel) && (
          <p
            id={`${id}-rgb-error`}
            className="rio:m-0 rio:text-xs rio:text-destructive"
          >
            {t('pickerRgbInvalid')}
          </p>
        )}
        <label htmlFor={`${id}-hex`} className="rio:grid rio:gap-1 rio:text-xs">
          <span>{t('pickerHex')}</span>
          <Input
            id={`${id}-hex`}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={state.hex}
            aria-invalid={hexInvalid || undefined}
            aria-describedby={hexInvalid ? `${id}-hex-error` : undefined}
            className="rio:h-10 rio:rounded-settings rio:aria-invalid:border-destructive"
            onChange={(event) => {
              if (!editable()) return;
              hexDirtyRef.current = true;
              update({ ...stateRef.current, hex: event.currentTarget.value });
            }}
            onBlur={commitHex}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitHex();
              }
            }}
          />
        </label>
        {hexInvalid && (
          <p
            id={`${id}-hex-error`}
            className="rio:m-0 rio:text-xs rio:text-destructive"
          >
            {t('invalidColor')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
