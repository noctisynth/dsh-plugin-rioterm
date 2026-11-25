import * as React from 'react';
import { RioIcon } from '../../components/rio-icon.tsx';

/** The dock supplies the flex row, active state, drag target and close button. */
export function TerminalTabTitle({
  title,
}: {
  title: string;
}): React.ReactElement {
  return (
    <>
      <RioIcon size={16} />
      <span data-rio-ui="tab-title" className="rio:min-w-0 rio:truncate">
        {title}
      </span>
    </>
  );
}
