# Falcon Deck Architecture and Data Model

## Architectural goal

Falcon Deck should separate **content**, **school-year scheduling**, and **section-specific execution** so teachers can reuse courses year after year without rebuilding them.

The product model is:

**District / school configuration → School year → Course template → Course instance → Section → Daily lesson instance → Optional section variance**

The key rule is that reusable instructional content must not be permanently tied to a specific calendar date or period.

---

## Core domains

### 1. School / district configuration
Owns infrastructure that rarely changes during a school year.

Examples:
- school name
- timezone
- branding
- bell schedule profiles
- master-calendar import conventions

### 2. School year
Represents one operating year, such as `2026-2027`.

Owns:
- first/last student day
- master calendar
- schedule exceptions
- active sections
- course sequence placement for that year

A school year is disposable/recreatable. Course content should survive it.

### 3. Bell schedule profile
Answers only:

**When does each instructional block occur?**

Examples:
- `OHHS_REGULAR`
- `OHHS_EARLY_RELEASE_1124`
- `OHHS_LAST_DAY_HALF_DAY`

Dates do not belong inside bell schedule profiles.

Passing periods may exist in the model but should normally be hidden from teacher-facing planning screens.

### 4. Master calendar
Answers:

**What kind of school day is this date?**

Examples:
- regular
- no school
- no students
- special bell schedule

The master calendar works as an exception overlay over the default Monday-Friday school pattern.

### 5. Course template
The long-lived instructional asset.

Examples:
- Algebra 1
- Geometry

Owns reusable material such as:
- unit sequence
- lesson templates
- standards/learning targets
- reusable resources
- assessment references
- teacher notes intended to survive year rollover

A course template does **not** own a period number or school-year date.

### 6. Course instance
A course template activated inside one school year.

Example:
- Algebra 1 template → Algebra 1, 2026-27

Owns:
- pacing/sequence placement for that year
- year-specific adjustments
- active sections

### 7. Section
A class period assigned to a course instance.

Examples:
- Period 1 Algebra 1
- Period 3 Algebra 1
- Period 5 Geometry

Owns only section-specific information:
- period/block mapping
- optional display name
- section-specific lesson variances
- section notes

It should inherit the course plan by default.

### 8. Daily course lesson
The default lesson for a course on an instructional sequence position/date.

Example:
- Algebra 1 → lesson 7 → Solving One-Step Equations

All Algebra 1 sections inherit this unless explicitly varied.

### 9. Section variance
A controlled override when one section is ahead, behind, or needs different material.

A variance should:
- inherit from the course lesson at creation time
- store only necessary overrides where practical
- be visibly labeled
- support returning to the shared course plan

### 10. Resource
Reusable instructional content independent of a single lesson.

Examples:
- Google Drive file
- website
- video
- document
- activity
- practice set

Resources can be attached to many lessons.

### 11. Assessment reference
Falcon Deck should initially **orchestrate**, not author or score, assessments.

An assessment reference can point to an external system such as Google Forms and include:
- type: entrance ticket / exit ticket / quiz
- external URL or Drive/Form identifier
- course
- lesson or learning target
- optional standards metadata

Future result ingestion should remain separate from assessment creation.

### 12. Announcement
Created once and targeted to:
- all classes
- one course
- one or more sections
- a date/date range

Announcements should never require duplicate manual entry across periods.

---

## Resolution pipeline

For any point in time, Falcon Deck should resolve the classroom state in this order:

1. **Resolve school date**
   - Is this a school day?
   - Is it no-school/no-students/special-bell/regular?

2. **Resolve bell schedule profile**
   - Which schedule applies today?

3. **Resolve teacher schedule**
   - Which period/block is active now?

4. **Resolve section**
   - Which course is mapped to this block?

5. **Resolve lesson**
   - Start with the course-level lesson.
   - Apply section variance if one exists.

6. **Resolve presentation content**
   - lesson
   - announcements
   - resources
   - assessment launch links
   - timer/routine state

This same pipeline should power Live Present Mode and Demo Mode. Demo Mode substitutes simulated time/data; it should not maintain separate scheduling logic.

---

## Course-first planning model

The normal planning screen should operate on courses.

Example:

`Algebra 1 | Tuesday, Sept. 8`

Teacher edits the lesson once.

Sections:
- Period 1 — inherited
- Period 3 — inherited
- Period 4 — variation

The software should not force the teacher to open and edit three copies of the Algebra lesson.

---

## Year rollover model

The long-term rollover workflow should be:

1. Create new school year.
2. Import new master calendar.
3. Confirm/import bell schedules.
4. Select prior course templates.
5. Choose whether to copy last year's sequence/pacing as the starting point.
6. Map current-year sections.
7. Falcon Deck lays the reusable course sequence onto the new instructional calendar.
8. Teacher reviews only exceptions.

### Content that should survive rollover
- course templates
- units
- lesson content
- reusable resources
- assessment references
- standards mappings
- reusable teacher notes

### Content that should normally be year-specific
- calendar dates
- section/period assignments
- snow-day shifts
- one-off announcements
- section variances
- year-specific pacing adjustments

---

## Future assessment insight architecture

Initial scope:

**Right assessment → right moment → results at a glance**

Falcon Deck should not initially replace the user's external question bank or Google Forms grading.

Proposed pipeline:
1. lesson references an entrance/exit assessment
2. Present Mode surfaces the correct assessment
3. Google handles collection/autograding
4. Falcon Deck retrieves summarized results
5. teacher sees:
   - class percent correct
   - question-level percent correct
   - learning-target/standard performance when metadata exists
6. threshold logic flags instructional response

Example default interpretation:
- 30%+ of class misses a target → consider whole-class reteach
- smaller subgroup misses → targeted support/grouping

Thresholds must eventually be configurable; they should not be hard-coded as pedagogical truth.

---

## Data ownership rules

1. There should be one canonical owner for each piece of information.
2. Derived state should be computed rather than copied.
3. Section overrides should not silently mutate course templates.
4. Year rollover should never destroy the prior year's record.
5. Imports must have review/validation before applying changes.
6. Demo data must remain isolated from production teacher data.
7. Presentation logic must use the same resolved production model as planning logic.

---

## Architectural decision test

Before adding a new field/entity, ask:

- Is this reusable instructional content or year-specific scheduling state?
- Is this course-level or section-specific?
- Can it be derived from existing data?
- Would storing it here make year rollover harder?
- Would this force duplicate entry?

Prefer the model that preserves reuse and minimizes teacher-maintained state.
