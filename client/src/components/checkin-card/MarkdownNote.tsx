import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface MarkdownNoteProps {
  note?: string | null;
  collapsible?: boolean;
}

export function MarkdownNote({ note, collapsible = false }: MarkdownNoteProps) {
  const [expanded, setExpanded] = useState(false);
  const [isLong, setIsLong] = useState(false);
  const noteRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!note || !collapsible || expanded || !noteRef.current) {
      if (!note || !collapsible) setIsLong(false);
      return;
    }

    const el = noteRef.current;
    const checkOverflow = () => {
      setIsLong(el.scrollHeight > el.clientHeight + 1);
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    return () => observer.disconnect();
  }, [collapsible, expanded, note]);

  if (!note) {
    return null;
  }

  const content = (
    <div
      ref={noteRef}
      className={`prose prose-sm dark:prose-invert max-w-none prose-p:my-0.5 prose-p:leading-relaxed prose-headings:my-1 prose-ul:my-0.5 prose-ol:my-0.5 text-gray-700 dark:text-gray-300 ${collapsible && !expanded ? 'line-clamp-3' : ''}`}
    >
      <ReactMarkdown components={{ a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
        {note}
      </ReactMarkdown>
    </div>
  );

  if (!collapsible) {
    return <div className="mt-2">{content}</div>;
  }

  return (
    <div className="mt-2">
      {content}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 mt-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
        >
          {expanded ? (
            <>
              Show less <ChevronUp size={12} />
            </>
          ) : (
            <>
              Read more <ChevronDown size={12} />
            </>
          )}
        </button>
      )}
    </div>
  );
}