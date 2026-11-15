import { useRef, useState, type ReactNode } from "react";
import type { ClaimRef, FeedItemRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { ContextParagraph } from "@cn/features/notes/ContextParagraph";
import { ClaimContent, claimContent } from "./ClaimContent";

/** The images a claim is grounded in, which are usually Substack charts or
 *  screenshots. They sit above the claim's context. Each one links out to the
 *  full-resolution original. */
function ClaimImages({ urls }: { urls: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt="Claim source"
            loading="lazy"
            className="max-h-48 w-auto rounded-control border border-line object-contain"
          />
        </a>
      ))}
    </div>
  );
}

/** The columns of a card on a wide screen: the paragraph, the card and the
 *  aside. The aside gets the larger share of the space beside the card,
 *  because it holds running text and the paragraph only a quote. Every card
 *  uses these columns, whether it has an aside or not, so a card does not move
 *  sideways when an aside appears and all cards line up. */
const ASIDE_GRID = "xl:grid xl:grid-cols-[minmax(0,0.7fr)_minmax(0,40rem)_minmax(0,1.3fr)] xl:gap-4";

/** On a wide screen the aside follows the window down as the reader scrolls,
 *  just below the site header (3.5rem), and stops at the bottom of its card's
 *  row. An aside taller than the window scrolls inside itself. */
const SIDE_STICKY = "xl:sticky xl:top-[4.5rem] xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto";

/** A card about one claim: the claim in its source at the top, and below it
 *  whatever the page shows about the claim. On a wide screen the paragraph
 *  around the claim sits beside the card, and `aside` on its other side. On a
 *  narrow one the paragraph opens above the card behind a button, and `aside`
 *  follows below the card. */
export function ClaimCard({ id, claim, paragraph, post, byline, aside, children }: {
  id?: string;
  claim: ClaimRef;
  /** The post's paragraph around the claim. It contains the claim's quote. */
  paragraph: string | null;
  post?: FeedItemRow;
  /** A line at the top of the card. */
  byline?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [ctxOpen, setCtxOpen] = useState(false);
  const cardColRef = useRef<HTMLDivElement>(null);
  const quoteInParagraph = claim.context_quote ?? claim.claim;
  return (
    <div
      id={id}
      className={cn("scroll-mt-4 items-start", ASIDE_GRID)}
    >
      {paragraph && (
        <div className="hidden min-w-0 [overflow-wrap:anywhere] xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} fitTo={cardColRef} />
        </div>
      )}
      {paragraph && (
        <div
          className="xl:hidden w-full max-w-[40rem] mx-auto"
          style={{ display: "grid", gridTemplateRows: ctxOpen ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
          aria-hidden={!ctxOpen}
        >
          <div className="overflow-hidden min-h-0">
            <div className="mb-2 [overflow-wrap:anywhere]">
              <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} bare />
            </div>
          </div>
        </div>
      )}
      <Card ref={cardColRef} className="p-4 w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
        {byline && <div className="mb-3">{byline}</div>}
        {/* A passage can hold a long unbroken address, which must wrap
            inside the card instead of pushing the page wider. */}
        <div className="mb-4 [overflow-wrap:anywhere]">
          {claim.image_urls.length > 0 && <ClaimImages urls={claim.image_urls} />}
          {paragraph && (
            <Button variant="link" className="xl:hidden text-xs mb-2" onClick={() => setCtxOpen((o) => !o)}>
              {ctxOpen ? "Hide surrounding context" : "Show surrounding context"}
            </Button>
          )}
          <ClaimContent content={claimContent(claim, post)} />
        </div>
        {children}
      </Card>
      {aside && <div className={cn("mx-auto mt-4 w-full min-w-0 max-w-[40rem] xl:col-start-3 xl:row-start-1 xl:mx-0 xl:mt-0 xl:max-w-none", SIDE_STICKY)}>{aside}</div>}
    </div>
  );
}
