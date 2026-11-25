import * as React from 'react';
import { RioIcon } from '../../components/rio-icon.tsx';
import { Button } from '../../components/ui/button.tsx';
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
  const descriptionId = React.useId();
  return (
    <Button
      variant="outline"
      data-rio-ui="guide"
      data-sidebar-right-guide-entry={RIO_TAB_KIND}
      aria-label={title}
      aria-describedby={description ? descriptionId : undefined}
      title={description}
      onClick={onOpen}
      className="rio:flex rio:min-h-[56px] rio:w-full rio:justify-start rio:gap-[14px] rio:rounded-guide rio:border-[0.5px] rio:border-guide-border rio:bg-muted rio:px-[20px] rio:py-[14px] rio:text-start rio:font-[number:inherit] rio:focus-visible:-outline-offset-2"
    >
      <span
        aria-hidden="true"
        className="rio:flex rio:size-[26px] rio:flex-none rio:items-center rio:justify-center rio:text-muted-foreground"
      >
        <RioIcon size={description ? 26 : 22} />
      </span>
      <span className="rio:flex rio:min-w-0 rio:flex-1 rio:flex-col rio:gap-[3px]">
        <span className="rio:truncate rio:text-[14px] rio:leading-[1.4]">
          {title}
        </span>
        {description && (
          <span
            id={descriptionId}
            className="rio:truncate rio:text-[11px] rio:leading-[1.4] rio:text-guide-description"
          >
            {description}
          </span>
        )}
      </span>
    </Button>
  );
}
