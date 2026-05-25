import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-stone-800">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
      {children}
    </pre>
  ),
  code: ({ children, className }) => {
    const isBlock = Boolean(className?.startsWith('language-'));
    return isBlock ? (
      <code className="font-mono text-xs leading-5 text-stone-700">{children}</code>
    ) : (
      <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-700">
        {children}
      </code>
    );
  },
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-4 text-stone-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-4 text-stone-700">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-6">{children}</li>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-3 text-sm font-semibold text-stone-800">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
      {children}
    </h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-stone-200 pl-3 text-stone-500">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-600 underline hover:text-sky-700"
    >
      {children}
    </a>
  ),
  hr: () => (
    <hr className="my-3 border-stone-200" />
  ),
};

interface MarkdownContentProps {
  children: string;
  className?: string;
}

export function MarkdownContent({ children, className }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      className={className}
      remarkPlugins={[remarkGfm]}
      components={MARKDOWN_COMPONENTS}
    >
      {children}
    </ReactMarkdown>
  );
}
