import { requestPasswordReset, signIn, signUp } from "@/lib/auth/actions";
import { getAuthenticatedClaims, resolveActiveOrganization, destinationForResolution } from "@/lib/auth/dal";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Already signed in - don't show the form again, per "open Falcon Deck ->
  // enter email/password -> work" (a returning session shouldn't re-prompt).
  const claims = await getAuthenticatedClaims();
  if (claims) {
    const resolution = await resolveActiveOrganization();
    redirect(destinationForResolution(resolution));
  }

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const sent = params.sent === "1";
  const resetSent = params.resetSent === "1";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-bold text-falcon-brown-900">Falcon Deck</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">Sign in or create an account.</p>
      </div>

      {sent && (
        <p className="rounded-md bg-falcon-gold-300/30 px-3 py-2 text-sm text-falcon-brown-900">
          Check your email to confirm your account before signing in.
        </p>
      )}
      {resetSent && (
        <p className="rounded-md bg-falcon-gold-300/30 px-3 py-2 text-sm text-falcon-brown-900">
          If that email is registered, a password reset link is on its way.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}

      <form className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
          />
        </label>
        <div className="mt-2 flex gap-2">
          <button
            formAction={signIn}
            type="submit"
            className="flex-1 rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100"
          >
            Sign in
          </button>
          <button
            formAction={signUp}
            type="submit"
            className="flex-1 rounded-md border border-falcon-brown-700/30 px-3 py-2 text-sm font-semibold text-falcon-brown-900"
          >
            Sign up
          </button>
        </div>
      </form>

      <form action={requestPasswordReset} className="flex flex-col gap-2 border-t border-falcon-brown-700/15 pt-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
          Forgot your password?
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
          />
        </label>
        <button type="submit" className="self-start text-sm font-semibold text-falcon-brown-700 underline">
          Send reset link
        </button>
      </form>
    </main>
  );
}
