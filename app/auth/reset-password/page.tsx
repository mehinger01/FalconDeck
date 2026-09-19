import { updatePassword } from "@/lib/auth/actions";
import { getAuthenticatedClaims } from "@/lib/auth/dal";
import { redirect } from "next/navigation";

export default async function ResetPasswordPage({ searchParams }: PageProps<"/auth/reset-password">) {
  // A valid recovery session must already exist by the time this page
  // renders - /auth/confirm establishes it before redirecting here.
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login?error=That+reset+link+expired.+Request+a+new+one.");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-bold text-falcon-brown-900">Set a new password</h1>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}

      <form action={updatePassword} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
          New password
          <input
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={6}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100"
        >
          Save new password
        </button>
      </form>
    </main>
  );
}
