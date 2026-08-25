# Falcon Deck Living Product Design

## Purpose

This document is the product-level checkpoint for Falcon Deck. It should be reviewed before meaningful feature work and updated whenever the product model, teacher workflow, or release priorities materially change.

Falcon Deck is not primarily a lesson repository or presentation app. It is a **teacher workflow system** designed to make classroom planning and execution feel automatic.

---

## Product statement

**Falcon Deck helps teachers spend less time managing tech and more time teaching.**

The product should know enough about the school year, bell schedule, courses, sections, lessons, and resources to remove routine teacher decisions wherever possible.

---

## Current product model

Falcon Deck should ultimately support this teacher loop:

### Configure once
- school/year
- master calendar
- bell schedules
- courses
- sections

### Plan by course
- build Algebra once
- build Geometry once
- reuse resources
- publish shared announcements

### Vary only when necessary
- one section gets ahead/behind
- create a local variance
- keep the shared course plan intact

### Teach automatically
- Falcon Deck resolves today's schedule
- Falcon Deck resolves the active section
- Present Mode loads the correct lesson
- teacher teaches instead of navigating software

### Reflect and adjust
- capture pacing changes
- later: assessment results identify reteach/targeted-support needs

### Reuse next year
- keep course templates/content
- replace calendar/year/sections
- remap sequence to new instructional days

---

## Teacher workflow targets

### Initial setup target
A capable teacher should be able to understand the setup sequence without documentation.

Ideal setup:
1. Start school year.
2. Upload master calendar.
3. Confirm bell schedule.
4. Add courses.
5. Map sections.
6. Begin planning.

Falcon Deck should validate data and explain errors in teacher language, not expose implementation details.

### Daily planning target
The teacher should rarely edit by period.

Ideal flow:
1. Open Today.
2. Select Algebra 1.
3. Build/edit lesson.
4. Apply to all sections.
5. Create a variance only if required.

### Classroom target
Teacher should not need to select the correct class manually under normal conditions.

### Announcement target
One message, one entry point, multiple targets.

### Resource target
Attach once, reuse many times.

---

## UX anti-patterns to prevent

Do not allow Falcon Deck to drift toward:
- one lesson copy per period
- repeated announcement entry
- schedule configuration visible on every planning screen
- giant all-purpose settings pages
- multiple places to edit the same canonical information
- required technical knowledge for imports
- manual period selection when schedule resolution already knows the answer
- hidden save failures
- features that duplicate what Google/Drive already does well without a strong reason

---

## Assessment orchestration vision

Falcon Deck should initially avoid becoming a full assessment-authoring engine.

Preferred division of labor:

### External assessment system / question bank
Owns:
- question creation
- item bank
- response collection
- autograding

### Falcon Deck
Owns:
- selecting the correct assessment for the lesson
- surfacing it at the correct time
- retrieving summarized results
- presenting actionable insight

Desired teacher output:
- overall class performance
- question-level performance
- target/standard performance when tagged
- flag when a substantial portion of the class needs reteaching
- flag smaller groups for targeted support

A working starting heuristic discussed for future design is approximately 30%+ missing a point as a potential whole-class reteach signal, but pedagogical thresholds must remain configurable and contextual rather than treated as universal truth.

---

## Year-over-year vision

Falcon Deck should become more valuable the longer a teacher uses it.

A teacher should not rebuild Algebra 1 next year.

Instead:
- course content persists
- resources persist
- assessments persist
- school-year dates change
- sections change
- pacing can be copied and adjusted

The ideal future year rollover should take minutes rather than hours.

---

## Decision framework for new work

Before starting a feature, answer:

### Teacher moment
What exact moment in the teacher's day does this support?

### Primary benefit
Does it reduce:
- clicks?
- cognitive load?
- duplicate entry?
- remembering?
- classroom risk?

### Canonical data owner
Where should this information live?

### Reuse level
Is it:
- reusable course content?
- school-year state?
- section-specific state?
- presentation-only derived state?

### Default vs exception
Is this a normal workflow or an edge case?

### Automation opportunity
Can Falcon Deck infer this rather than asking the teacher?

### Day-one relevance
Does it improve the reliable daily classroom loop enough to outrank current 1.0 work?

---

## Standard development process

For every meaningful feature:

1. **State the teacher problem.**
2. **Map the teacher workflow before coding.**
3. **Identify the canonical data owner.**
4. **Design the 90% default workflow.**
5. **Put edge cases behind progressive disclosure.**
6. **Check for duplicate entry.**
7. **Implement using shared production logic where possible.**
8. **Test the actual teacher journey, not just isolated components.**
9. **Run the UX checklist.**
10. **Update this living design document if the product model changed.**

---

## Current priorities

1. Stabilize current production behavior.
2. Finish course-first planning and multi-section inheritance/variance.
3. Simplify teacher-facing planning screens.
4. Centralize announcements.
5. Run full daily-loop regression testing in Demo Mode.
6. Launch dependable 1.0.
7. Add assessment orchestration/results insight.
8. Build polished year-rollover workflow.

---

## Product guardrail

Falcon Deck wins by making complicated classroom logistics feel simple.

When forced to choose between adding a visible capability and removing a teacher decision, prefer removing the decision.
