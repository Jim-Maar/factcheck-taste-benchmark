import { useState } from "react";
import type { Source } from "@cn/core/taste";
import { SignInForm } from "@cn/features/auth/SignInForm";
import { useSession } from "@cn/features/auth/useSession";
import { Page } from "@cn/ui/Page";
import { PageTitle } from "@cn/ui/typography";
import { SiteHeader, TABS } from "./components/SiteHeader";
import { NOTE_FIELDS } from "./noteFields";
import { NoteTab } from "./NoteTab";
import { CnNoteCard } from "./pages/commonnotes/CnNoteCard";
import { XNoteCard } from "./pages/x/XNoteCard";

const TAB_PARAM = "tab";

const readTab = (): Source => {
  const tab = new URLSearchParams(window.location.search).get(TAB_PARAM);
  return TABS.find((t) => t.source === tab)?.source ?? "x";
};

const INTRO: Record<Source, string> = {
  x: "Community Notes on X by AI notewriters that X rated helpful or not helpful, from X's public data.",
  commonnotes: "Every note on commonnotes.net, with its claim, post and votes.",
};

/** Switching tabs starts the new tab from its own remembered filters, so the
 *  address keeps only the tab. Each tab writes its filters back once it
 *  mounts. */
function showTabInAddress(tab: Source) {
  window.history.pushState(null, "", `${window.location.pathname}?${TAB_PARAM}=${tab}`);
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
  const [tab, setTab] = useState<Source>(readTab);
  const changeTab = (next: Source) => {
    if (next === tab) return;
    showTabInAddress(next);
    setTab(next);
  };
  return (
    <>
      <SiteHeader tab={tab} onTab={changeTab} signedIn={!!session} />
      {!ready ? null : !session ? (
        <SignInPage />
      ) : (
        <Page width="wide" className="space-y-6">
          <div className="space-y-2">
            <PageTitle>{TABS.find((t) => t.source === tab)!.label}</PageTitle>
            <p className="text-sm text-fg-secondary">{INTRO[tab]}</p>
          </div>
          {tab === "x" ? (
            <NoteTab key="x" source="x" fields={NOTE_FIELDS.x} renderCard={(card) => <XNoteCard note={card} />} />
          ) : (
            <NoteTab key="commonnotes" source="commonnotes" fields={NOTE_FIELDS.commonnotes} renderCard={(card) => <CnNoteCard card={card} />} />
          )}
        </Page>
      )}
    </>
  );
}
