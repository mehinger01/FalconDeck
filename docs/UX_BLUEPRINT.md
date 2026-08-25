# Falcon Deck UX Blueprint

## Product promise

**Falcon Deck helps teachers spend less time managing tech and more time teaching.**

Falcon Deck should feel like quiet classroom infrastructure: it knows the schedule, knows the course, knows what is likely to happen next, and stays out of the teacher's way.

The primary design goal is not feature density. It is **lower cognitive load**.

---

## Core UX principles

### 1. Configure once, automate forever

Anything a teacher can reasonably set once should disappear into the background after setup.

Examples:
- bell schedules
- passing periods
- school-year calendar exceptions
- course-to-period mappings
- recurring classroom routines
- default presentation behavior

The teacher should not repeatedly manage infrastructure that Falcon Deck already knows.

### 2. Teachers think in courses, not periods

A teacher usually plans **Algebra 1** or **Geometry**, not "2nd hour" or "5th hour."

Default workflow:
1. Build one course lesson.
2. Apply it to every section of that course.
3. Create a section variance only when needed.

Period-level editing is an exception workflow, not the main workflow.

### 3. One source of truth, exceptions only

Duplicate entry is a design failure.

Examples:
- one Algebra lesson can feed all Algebra sections
- one announcement can publish to all relevant classes
- one resource can be reused across lessons
- one master calendar controls date exceptions

When a section diverges, Falcon Deck should preserve the shared source and create a local override rather than forcing full duplication.

### 4. Progressive disclosure

The 90% workflow stays visible. Advanced configuration stays available but out of the way.

Examples:
- passing periods hidden after setup
- advanced bell-schedule controls behind an expandable section
- section-specific overrides visible only when invoked
- technical import details hidden behind validation/review screens

### 5. Predict the next teacher action

Every major screen should prioritize what the teacher is most likely trying to do at that moment.

Examples:
- before school: today's schedule and first class
- during prep: edit today's lessons
- during class: Present Mode
- after class: quick notes / next-step adjustments

### 6. Optimize for the 90% case

Do not clutter the primary experience to accommodate rare edge cases. Edge cases should remain possible through secondary controls.

### 7. Reduce clicks, thinking, and duplicate entry

Every proposed feature must answer at least one of these questions:
- Does this reduce clicks?
- Does this reduce decision-making?
- Does this remove duplicate entry?
- Does this prevent a teacher from having to remember something?

If the answer is no, the feature needs stronger justification.

### 8. Make state obvious

A teacher should immediately know:
- what day/schedule Falcon Deck believes it is
- which course/section is active
- whether a lesson is shared or overridden
- whether changes are saved
- whether the app is in Demo, Preview, Present, or Open House mode

### 9. Mobile should support light work, not recreate the desktop

The web app should remain responsive enough for a teacher to:
- check today's plan
- preview a lesson
- make a small text edit
- add an idea/resource

Full Present Mode and heavy configuration remain desktop-first.

### 10. Reliability beats novelty

During instruction, Falcon Deck must be boringly dependable. A clever feature that adds risk to the daily classroom loop should wait.

---

## Teacher-day journey

### Arrival
Teacher opens Falcon Deck.

Falcon Deck should already know:
- today's date
- whether school is in session
- which bell schedule applies
- the teacher's courses/sections
- the first upcoming class

Primary actions:
- View today
- Edit today
- Start Present Mode

### Prep / planning
Teacher plans by course.

Primary flow:
1. Open Algebra 1.
2. Edit today's lesson once.
3. Apply to all Algebra sections.
4. If needed, create a section variance.
5. Repeat for Geometry.

Passing periods, bell times, and schedule machinery should not occupy normal planning-screen real estate.

### Teaching
Present Mode should automatically surface the correct class and lesson based on the resolved schedule.

The teacher should not need to navigate through planning menus during instruction.

### Transition
Falcon Deck should handle period transitions automatically from the bell schedule.

### Review / adjust
Teacher can quickly:
- mark a lesson as ahead/behind
- create a section-specific adjustment
- edit tomorrow's lesson
- note a reteach need

---

## Daily planning interaction model

### Course-first planning
A lesson belongs primarily to a course/day, not a period.

Example:
- Algebra 1 — Sept. 8 — Solving One-Step Equations

Sections inherit that lesson by default.

### Apply to all sections
One obvious action should distribute a lesson to all active sections of the same course.

Suggested label:
**Apply to all Algebra 1 sections**

### Section variance
If one section gets ahead or behind:
- click **Create variation**
- Falcon Deck copies only what is necessary into a section override
- the UI clearly marks that section as varied
- teacher can later **Return to course plan**

### Announcements
Announcements should be created once and targeted by:
- all classes
- course
- section
- date range

A teacher should never retype the same announcement in multiple classes.

---

## Setup flow

### Step 1 — School year
- school name
- school year
- timezone

### Step 2 — Master calendar
- download template or upload existing calendar
- review parsed exceptions
- apply

### Step 3 — Bell schedules
- choose built-in profile or import
- verify regular and special schedules
- hide passing periods from normal screens after setup

### Step 4 — Courses
Create course templates such as:
- Algebra 1
- Geometry

### Step 5 — Sections
Map periods to courses.

Example:
- Period 1 → Algebra 1
- Period 2 → Geometry
- Period 3 → Algebra 1

### Step 6 — Ready
Falcon Deck generates the daily teaching framework automatically.

---

## UX review checklist

Every feature and pull request should be reviewed against these questions:

- What exact teacher moment does this serve?
- Is this part of the 90% workflow or an edge case?
- Can Falcon Deck infer this instead of asking the teacher?
- Is the teacher entering information that already exists elsewhere?
- Can this be configured once and hidden afterward?
- Does this add visual real estate to the normal workflow?
- Could this be moved behind progressive disclosure?
- Does this create duplicate sources of truth?
- Is the default action obvious within five seconds?
- Does this work without a manual?
- Does it reduce clicks, cognitive load, or duplicate entry?
- Does it make the classroom loop more reliable?

If a feature fails several of these questions, redesign it before shipping.
