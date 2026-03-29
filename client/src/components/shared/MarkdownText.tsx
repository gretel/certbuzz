import ReactMarkdown from 'react-markdown';

interface MarkdownTextProps {
  children: string;
  className?: string;
}

export function MarkdownText({ children, className }: MarkdownTextProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          // Render paragraphs as spans to avoid nested <p> issues
          p: ({ children }) => <span className="block mb-2 last:mb-0">{children}</span>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc list-inside mt-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mt-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
