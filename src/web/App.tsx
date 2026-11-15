import { useState } from "react";
import { SignInForm } from "@cn/features/auth/SignInForm";
import { useSession } from "@cn/features/auth/useSession";
import { Page } from "@cn/ui/Page";
import { PageTitle } from "@cn/ui/typography";
import { SiteHeader, TABS, type Tab } from "./components/SiteHeader";
import { NOTE_FIELDS } from "./noteFields";
import { NoteTab, queryStorageKey } from "./NoteTab";
import { CnNoteCard } from "./pages/commonnotes/CnNoteCard";
import { SummaryTab } from "./pages/summary/SummaryTab";
import { XNoteCard } from "./pages/x/XNoteCard";

const TAB_PARAM = "tab";

const readTab = (): Tab => {
  const tab = new URLSearchParams(window.location.search).get(TAB_PARAM);
  return TABS.find((t) => t.source === tab)?.source ?? "x";
};

const INTRO: Record<Tab, string> = {
  x: "Community Notes on X by AI notewriters that X rated helpful or not helpful, from X's public data.",
  commonnotes: "Every note on commonnotes.net, with its claim, post and votes.",
  summary: "Labels, AI reviews and costs for the Community Notes tab.",
};

/** Switching tabs starts the new tab from its own remembered filters, so the
 *  address keeps only the tab. Each tab writes its filters back once it
 *  mounts. */
function showTabInAddress(tab: Tab) {
  window.history.pushState(null, "", `${window.location.pathname}?${TAB_PARAM}=${tab}`);
}

/** Home: the first tab with no search and no filters. Its remembered filters
 *  are forgotten too, or the tab would bring them back. The page reloads, so
 *  every tab starts afresh. */
function goHome() {
  try {
    window.localStorage.removeItem(queryStorageKey("x"));
  } catch {
    // Without storage there are no remembered filters to forget.
  }
  window.location.assign(window.location.pathname);
}

function SignInPage() {
  return (
    <Page width="form" className="space-y-4">
      <PageTitle>Taste Benchmark</PageTitle>
      <p className="text-sm text-fg-secondary">A place to look through AI-written fact-check notes and mark the ones that show a failure of taste. Sign in with the shared password.</p>
      <SignInForm />
    </Page>
  );
}

export function App() {
  const { session, ready } = useSession();
  const [tab, setTab] = useState<Tab>(readTab);
  const changeTab = (next: Tab) => {
    if (next === tab) return;
    showTabInAddress(next);
    setTab(next);
  };
  return (
    <>
      <SiteHeader tab={tab} onTab={changeTab} onHome={goHome} signedIn={!!session} />
      {!ready ? null : !session ? (
        <SignInPage />
      ) : (
        <Page width="wide" className="space-y-6">
          <div className="space-y-2">
            <PageTitle>{TABS.find((t) => t.source === tab)!.label}</PageTitle>
            <p className="text-sm text-fg-secondary">{INTRO[tab]}</p>
          </div>
          {tab === "summary" ? (
            <SummaryTab />
          ) : tab === "x" ? (
            <NoteTab key="x" source="x" fields={NOTE_FIELDS.x} renderCard={(card) => <XNoteCard note={card} />} />
          ) : (
            <NoteTab key="commonnotes" source="commonnotes" fields={NOTE_FIELDS.commonnotes} renderCard={(card) => <CnNoteCard card={card} />} />
          )}
        </Page>
      )}
    </>
  );
}
