import { cn } from '@/lib/utils';
import { Sparkles, User, ImageIcon, ThumbsUp, ThumbsDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, useEffect } from 'react';
import { useWallet } from '@/contexts/WalletContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ChatMessageProps {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
  imagePreview?: string;
  agentsUsed?: string[];
}

export function ChatMessage({ id, content, isUser, timestamp, imagePreview, agentsUsed }: ChatMessageProps) {
  const { address } = useWallet();
  const [rating, setRating] = useState<boolean | null>(null);
  const [isRating, setIsRating] = useState(false);

  // Check if this was an image message that can't be displayed (placeholder from DB)
  const hadImage = imagePreview === '[Image]' || content === '[Image attached]';
  const canShowImage = imagePreview && imagePreview.startsWith('data:');

  // Load existing rating on mount
  useEffect(() => {
    if (!isUser && address && id) {
      fetch(`${API_BASE_URL}/ratings/${id}?wallet=${address}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.rating !== null) {
            setRating(data.rating);
          }
        })
        .catch(() => { });
    }
  }, [id, address, isUser]);

  const handleRate = async (isPositive: boolean) => {
    if (!address || rating !== null || isRating) return;

    setIsRating(true);
    try {
      // Use the first agent from agentsUsed for the rating
      const agentId = agentsUsed && agentsUsed.length > 0 ? agentsUsed[0] : undefined;

      const res = await fetch(`${API_BASE_URL}/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: id,
          walletAddress: address,
          isPositive,
          agentId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRating(isPositive);
      }
    } catch (e) {
      console.error('Failed to rate:', e);
    } finally {
      setIsRating(false);
    }
  };


  return (
    <div className={cn("flex gap-4 animate-fade-in max-w-3xl mx-auto w-full px-4", isUser ? "flex-row-reverse" : "")}>
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
        isUser ? "bg-primary/20" : "bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500"
      )}>
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Sparkles className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message */}
      <div className={cn("flex-1 min-w-0", isUser ? "text-right" : "")}>
        {/* Image Preview - actual image or placeholder */}
        {canShowImage && (
          <div className={cn("mb-2", isUser ? "flex justify-end" : "")}>
            <img
              src={imagePreview}
              alt="Uploaded"
              className="max-h-48 rounded-xl border border-border"
            />
          </div>
        )}
        {/* Placeholder for images that can't be displayed */}
        {hadImage && !canShowImage && (
          <div className={cn("mb-2", isUser ? "flex justify-end" : "")}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/50 border border-border/50 text-muted-foreground text-sm">
              <ImageIcon className="w-4 h-4" />
              <span>Image attached</span>
            </div>
          </div>
        )}

        {content && (
          <div className={cn(
            "prose prose-sm max-w-none break-words dark:prose-invert",
            "text-foreground",
            "prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-secondary/50 prose-pre:border prose-pre:border-border/50",
            "prose-headings:font-medium prose-headings:text-foreground/90",
            "prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline hover:prose-a:text-blue-300",
            "prose-code:text-cyan-400 prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal",
            "prose-strong:text-foreground",
            "prose-li:text-foreground prose-ul:my-2 prose-ol:my-2",
            "prose-p:text-foreground",
            "prose-li:my-0.5"
          )}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Make all links open in new tab
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {children}
                  </a>
                ),
                // Convert inline code that looks like a URL into a clickable link
                code: ({ children, className }) => {
                  const text = String(children).trim();
                  // Check if it looks like a URL (starts with http, https, or looks like a domain)
                  const isUrl = /^(https?:\/\/|www\.)|(\.[a-z]{2,}(\/|$))/i.test(text);

                  if (isUrl && !className) {
                    const href = text.startsWith('http') ? text : `https://${text}`;
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        {text}
                      </a>
                    );
                  }

                  // Regular code styling
                  return (
                    <code className="text-cyan-400 bg-white/10 px-1.5 py-0.5 rounded font-normal">
                      {children}
                    </code>
                  );
                }
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}

        {/* Rating buttons - only for AI messages */}
        {!isUser && (
          <div className="flex items-center gap-2 mt-2 justify-end">
            {rating === null ? (
              <>
                <button
                  onClick={() => handleRate(true)}
                  disabled={isRating}
                  className="p-1.5 text-muted-foreground hover:text-green-500 transition-colors disabled:opacity-50"
                  title="Good response"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleRate(false)}
                  disabled={isRating}
                  className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Bad response"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <div className={cn(
                "p-1.5",
                rating ? "text-green-500" : "text-red-500"
              )}>
                {rating ? <ThumbsUp className="w-3.5 h-3.5" /> : <ThumbsDown className="w-3.5 h-3.5" />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
