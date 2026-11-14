import { useState } from "react";
import { signInWithPassword } from "@cn/core/auth";
import { Button } from "@cn/ui/Button";
import { Input } from "@cn/ui/Field";

/** The sign-in form: one box for the shared password. Built like the
 *  commonnotes.net email form. */
export function SignInForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: signInError } = await signInWithPassword(password);
    setBusy(false);
    if (signInError) setError(signInError.message === "Invalid login credentials" ? "That password is not right." : signInError.message);
  };

  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className="flex-1 min-w-0"
        />
        <Button type="submit" disabled={busy || password.length === 0}>
          Sign in
        </Button>
      </form>
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
