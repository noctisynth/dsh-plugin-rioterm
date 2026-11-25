import * as React from 'react';
import { RIO_TAB_KIND } from '../../terminal/identity.ts';

interface TerminalGuideProps {
  title: string;
  description?: string | undefined;
  onOpen: () => void;
}

export function TerminalGuide({
  title,
  description,
  onOpen,
}: TerminalGuideProps): React.ReactElement {
  return (
    <button
      type="button"
      data-sidebar-right-guide-entry={RIO_TAB_KIND}
      onClick={onOpen}
      title={description}
      style={{
        width: '100%',
        textAlign: 'start',
        cursor: 'pointer',
        padding: '0.6em 0.9em',
        font: 'inherit',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid currentColor',
        borderRadius: 8,
      }}
    >
      {title}
      {description && <small style={{ display: 'block' }}>{description}</small>}
    </button>
  );
}
