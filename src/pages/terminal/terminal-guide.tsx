import * as React from 'react';
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
      className="rio:min-h-14 rio:w-full rio:flex-col rio:items-start rio:gap-0.5 rio:rounded-lg rio:bg-muted rio:px-5 rio:py-3.5 rio:text-start rio:focus-visible:-outline-offset-2"
    >
      <span className="rio:max-w-full">{title}</span>
      {description && (
        <span
          id={descriptionId}
          className="rio:max-w-full rio:text-xs rio:font-normal rio:text-muted-foreground"
        >
          {description}
        </span>
      )}
    </Button>
  );
}
