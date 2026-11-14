import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/* Everyone signs in as one shared Supabase user. The page only asks for the
 * password, and this address names that user. It is not a real mailbox. */
const SHARED_LOGIN_EMAIL = "labellers@factcheck-taste-benchmark.invalid";

/** The current session, as one store for the whole page. `ready` turns true
 *  once the stored session has been read. `event` is the last auth
 *  transition. Copied from commonnotes.net's session store. */
export interface SessionState {
  session: Session | null;
  ready: boolean;
  event: AuthChangeEvent | null;
}

let sessionState: SessionState = { session: null, ready: false, event: null };
const sessionListeners = new Set<() => void>();
let watchingSession = false;

function publishSession(next: Partial<SessionState>) {
  sessionState = { ...sessionState, ...next };
  sessionListeners.forEach((listener) => listener());
}

function watchSession() {
  watchingSession = true;
  void supabase.auth.getSession().then(({ data }) => publishSession({ session: data.session, ready: true }));
  supabase.auth.onAuthStateChange((event, session) => publishSession({ session, event }));
}

/** Subscribes to session changes, in the shape React's useSyncExternalStore
 *  expects. The returned function unsubscribes. */
export function subscribeToSession(listener: () => void): () => void {
  if (!watchingSession) watchSession();
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export const currentSessionState = (): SessionState => sessionState;

/** Signs in with the shared password. Supabase keeps the session in this
 *  browser, so each person types the password once per browser. */
export function signInWithPassword(password: string) {
  return supabase.auth.signInWithPassword({ email: SHARED_LOGIN_EMAIL, password });
}

/** Signs out of this browser only. */
export function signOut() {
  return supabase.auth.signOut({ scope: "local" });
}
