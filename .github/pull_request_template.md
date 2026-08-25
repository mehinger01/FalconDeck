## What teacher problem does this solve?

Describe the concrete teacher moment/problem this change addresses.

## Teacher workflow

Describe the expected workflow before and after this change.

## UX review

- [ ] The primary action is obvious within roughly five seconds.
- [ ] This reduces clicks, cognitive load, duplicate entry, remembering, or classroom risk.
- [ ] Falcon Deck infers information where reasonable instead of asking the teacher again.
- [ ] The 90% workflow stays visible; edge cases use progressive disclosure.
- [ ] This does not create a second source of truth.
- [ ] Course-level data stays course-level; section overrides are used only when necessary.
- [ ] Bell schedules/passing periods remain background plumbing unless the teacher is explicitly configuring them.
- [ ] Save/persistence state is clear if failure would matter.
- [ ] Mobile remains usable for basic viewing/light editing when relevant.

## Architecture review

- [ ] I identified the canonical owner for any new data.
- [ ] Reusable instructional content is not unnecessarily tied to a school-year date/period.
- [ ] Derived state is computed rather than duplicated where practical.
- [ ] Demo/test behavior uses shared production logic rather than a parallel implementation where practical.
- [ ] This change does not make year rollover materially harder.

## Classroom-loop testing

Check the applicable scenarios:

- [ ] Before school
- [ ] During an active class
- [ ] Passing period / transition
- [ ] Prep/planning
- [ ] Special bell schedule
- [ ] No-school/no-student day
- [ ] After school
- [ ] Reload/persistence
- [ ] Demo Mode isolation

## 1.0 priority check

- [ ] This helps the teacher teach tomorrow with less friction/reliability risk, **or** it is necessary architecture that prevents expensive rework.
- [ ] If not, the reason this belongs ahead of the backlog is documented below.

## Notes / exceptions

Document deliberate deviations from the Falcon Deck UX Blueprint or Architecture and Data Model.
