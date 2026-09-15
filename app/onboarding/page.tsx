import { redirect } from "next/navigation";
import { createOrganization, selectOrganization } from "@/lib/auth/actions";
import { destinationForResolution, requireAuthenticatedUser, resolveActiveOrganization } from "@/lib/auth/dal";

/**
 * Requires authentication but deliberately not a resolved organization -
 * this is the page that resolves one. Renders one of three states:
 * zero memberships (create-organization shell, Phase 2 stub), multiple
 * unresolved memberships (select one), or already-resolved (nothing to do
 * here, send the user on).
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireAuthenticatedUser();

  const resolution = await resolveActiveOrganization();
  if (resolution.state === "resolved") redirect(destinationForResolution(resolution));

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-bold text-falcon-brown-900">Welcome to Falcon Deck</h1>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}

      {resolution.state === "needs-selection" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-falcon-brown-700/70">Choose which school you&apos;re working in.</p>
          {resolution.memberships.map((membership) => (
            <form key={membership.organizationId} action={selectOrganization}>
              <input type="hidden" name="organizationId" value={membership.organizationId} />
              <button
                type="submit"
                className="w-full rounded-md border border-falcon-brown-700/30 px-3 py-2 text-left text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20"
              >
                {membership.organizationName}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-falcon-brown-700/70">
            You&apos;re not part of a school yet. Enter your school&apos;s name to get started.
          </p>
          <form action={createOrganization} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
              School name
              <input
                name="organizationName"
                type="text"
                required
                placeholder="e.g. Ogemaw Heights High School"
                className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100"
            >
              Create school
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
