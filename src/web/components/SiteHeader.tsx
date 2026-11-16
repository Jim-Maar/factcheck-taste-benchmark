import logoUrl from "@cn/ui/assets/logo.svg";
import type { Source } from "@cn/core/taste";
import { signOut } from "@cn/core/auth";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";

const navLink = cn(
  "rounded-control text-sm font-medium text-fg-secondary hover:text-fg aria-[current=page]:text-fg focus-visible:ring-offset-2",
  focusRing,
);

/** A tab: one of the two lists of notes, the summary of them, or the
 *  notewriter eval. */
export type Tab = Source | "summary" | "eval";

export const TABS: { source: Tab; label: string }[] = [
  { source: "x", label: "Community Notes" },
  { source: "commonnotes", label: "CommonNotes" },
  { source: "summary", label: "Summary" },
  { source: "eval", label: "Notewriter eval" },
];

/** The bar at the top of the page, as on commonnotes.net: the name on the
 *  left, linking home, the tabs where the website lists its pages, and signing out on
 *  the right. */
export function SiteHeader({ tab, onTab, onHome, signedIn }: { tab: Tab; onTab: (tab: Tab) => void; onHome: () => void; signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 sm:h-14 sm:flex-nowrap sm:gap-6 sm:px-4 sm:py-0 md:px-8">
        <a
          href={window.location.pathname}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onHome();
          }}
          className={cn("flex shrink-0 items-center gap-2 rounded-control font-title text-sm font-bold text-fg sm:text-base", focusRing)}
        >
          <img src={logoUrl} alt="" width={26} height={26} />
          Taste Benchmark
        </a>
        {signedIn && (
          <nav aria-label="Tabs" className="order-last flex w-full flex-wrap items-center gap-x-5 gap-y-1 sm:order-none sm:w-auto">
            {TABS.map(({ source, label }) => (
              <a
                key={source}
                href={`?tab=${source}`}
                aria-current={tab === source ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onTab(source);
                }}
                className={navLink}
              >
                {label}
              </a>
            ))}
          </nav>
        )}
        {signedIn && (
          <div className="ml-auto flex items-center gap-3">
            <Button variant="quiet" className="text-sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
