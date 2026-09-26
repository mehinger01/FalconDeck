import Link from "next/link";
import { redirect } from "next/navigation";
import { createOrganization, joinExistingSchool, selectOrganization } from "@/lib/auth/actions";
import {
  SCHOOL_SEARCH_MIN_LENGTH,
  destinationForResolution,
  requireAuthenticatedUser,
  resolveActiveOrganization,
  searchOrganizations,
  type SchoolSearchResult,
} from "@/lib/auth/dal";

/** city + state if both, city only, state only, or nothing at all - never a placeholder like "Unknown" for a missing field. */
function formatSchoolLocation(school: SchoolSearchResult): string | null {
  if (school.city && school.state) return `${school.city}, ${school.state}`;
  if (school.city) return school.city;
  if (school.state) return school.state;
  return null;
}

/**
 * Requires authentication but deliberately not a resolved organization -
 * this is the page that resolves one. Renders one of three states:
 * zero memberships (server-rendered "Find your school" search + "Add your
 * school" screen, Stage C), multiple unresolved memberships (select one,
 * unchanged from Phase 1), or already-resolved (nothing to do here, send
 * the user on).
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireAuthenticatedUser();

  const resolution = await resolveActiveOrganization();
  if (resolution.state === "resolved") redirect(destinationForResolution(resolution));

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const screen = typeof params.screen === "string" ? params.screen : null;
  const query = typeof params.q === "string" ? params.q : "";

  const showCreateScreen = resolution.state === "none" && screen === "create";
  const searchOutcome =
    resolution.state === "none" && !showCreateScreen ? await searchOrganizations(query) : { schools: [], error: null };
  const trimmedQuery = query.trim();
  const hasSearched = trimmedQuery.length >= SCHOOL_SEARCH_MIN_LENGTH;

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
      ) : showCreateScreen ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-falcon-brown-900">Add your school</h2>
          <form action={createOrganization} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
              School name
              <input
                name="organizationName"
                type="text"
                required
                placeholder="Your school's name"
                className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
              City <span className="font-normal text-falcon-brown-700/60">(optional)</span>
              <input
                name="city"
                type="text"
                className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-falcon-brown-800">
              State <span className="font-normal text-falcon-brown-700/60">(optional)</span>
              <input
                name="state"
                type="text"
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
          <Link href="/onboarding" className="text-sm font-semibold text-falcon-brown-700 underline decoration-falcon-gold-500 decoration-2 underline-offset-2 hover:text-falcon-brown-900">
            ← Back to school search
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-falcon-brown-900">Find your school</h2>
          <form className="flex gap-2">
            <input
              name="q"
              type="text"
              defaultValue={query}
              placeholder="Search schools by name"
              className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-falcon-brown-900"
            />
            <button
              type="submit"
              className="rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100"
            >
              Search
            </button>
          </form>

          {hasSearched && (
            <div className="flex flex-col gap-2">
              {searchOutcome.error ? (
                <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
                  {searchOutcome.error}
                </p>
              ) : searchOutcome.schools.length === 0 ? (
                <p className="text-sm text-falcon-brown-700/70">No matches found. Try another search or add your school.</p>
              ) : (
                searchOutcome.schools.map((school) => {
                  const location = formatSchoolLocation(school);
                  return (
                    <div
                      key={school.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-falcon-brown-900">{school.name}</p>
                        {location && <p className="text-xs text-falcon-brown-700/60">{location}</p>}
                      </div>
                      <form action={joinExistingSchool}>
                        <input type="hidden" name="targetOrganizationId" value={school.id} />
                        <button
                          type="submit"
                          className="shrink-0 rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20"
                        >
                          Join school
                        </button>
                      </form>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <Link href="/onboarding?screen=create" className="text-sm font-semibold text-falcon-brown-700 underline decoration-falcon-gold-500 decoration-2 underline-offset-2 hover:text-falcon-brown-900">
            Can&apos;t find your school? Add it
          </Link>
        </div>
      )}
    </main>
  );
}
