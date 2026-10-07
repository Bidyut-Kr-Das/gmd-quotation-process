import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

export const Markdown = memo(function Markdown({
  children,
}: {
  children: string;
}) {
  return (
    <div className="text-[13px] leading-5 [&_p]:my-0 [&_p+p]:mt-2 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-[13px] [&_h2]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_table]:border-collapse [&_table]:text-[12px] [&_table]:scrollbar-thin [&_table]:[scrollbar-color:var(--border)_transparent] [&_table]:[&::-webkit-scrollbar]:h-1 [&_table]:[&::-webkit-scrollbar-track]:bg-transparent [&_table]:[&::-webkit-scrollbar-thumb]:rounded-full [&_table]:[&::-webkit-scrollbar-thumb]:bg-border [&_th]:border [&_th]:border-border [&_th]:bg-[#0a2540] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-white [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_a]:text-[#0f62fe] [&_a]:underline [&_a]:underline-offset-2 [&_a]:transition-colors [&_a]:duration-200 [&_a]:hover:text-[#0353e9] [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_strong]:rounded-sm [&_strong]:text-emerald-600 [&_strong]:px-1 [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
});