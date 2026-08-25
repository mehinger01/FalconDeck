# Falcon Deck 1.0 Roadmap

## North star

**Falcon Deck helps teachers spend less time managing tech and more time teaching.**

The first release is successful when a teacher can walk into class, open Falcon Deck, and trust that it already knows today's schedule, today's class, and today's lesson.

---

## Falcon Deck 1.0 definition of done

Day one should support the complete daily classroom loop without friction.

### Required for day one

#### 1. Master calendar works
- teacher can import district calendar exceptions
- no-school/no-student/special-bell days resolve correctly
- teacher does not manually maintain 180 dates
- imported data is reviewed before applying

#### 2. Bell schedule works
- regular schedule configured
- known special schedules configured
- schedule resolution is automatic by date
- passing periods remain background infrastructure rather than planning-screen clutter

#### 3. Course-first planning works
- teacher creates courses such as Algebra 1 and Geometry
- periods/sections map to courses once
- teacher edits the daily course lesson once
- one action applies that lesson to all sections
- a section can create a variance without breaking the shared course plan

#### 4. Present Mode works reliably
- Falcon Deck resolves the current class automatically
- correct lesson is displayed
- school-day boundaries behave correctly
- timers/routines work
- branding is stable
- the teacher does not need to navigate planning screens while teaching

#### 5. Resource access works
- resources can be stored/reused
- Google Drive links/files can be associated with lessons
- resources are one-click accessible during planning/presentation

#### 6. Announcements are single-entry
- teacher enters an announcement once
- can target all classes, one course, or selected sections
- no repeated copy/paste between periods

#### 7. Data/save behavior is trustworthy
- saves are explicit where failure matters
- failures surface clearly
- demo data cannot contaminate live teacher data

---

## Day-one teacher success test

At the start of the day, Falcon Deck should be able to present a state conceptually like:

> Good morning. Today is a regular schedule. First hour Algebra 1 begins at 8:05. Your lesson is ready.

During prep:

> Edit Algebra 1 once → Apply to all Algebra sections.

If one section falls behind:

> Period 3 → Create variation.

That is the core 1.0 experience.

---

## Build order before day one

### Priority 0 — stabilize what exists
- fix known deployment/asset issues
- run production smoke tests
- verify calendar resolution
- verify schedule resolution
- verify Present Mode across normal/special/off-hours scenarios
- verify persistence after reload

### Priority 1 — course-first planning
Build/refine:
- course-level daily lesson editor
- section inheritance indicator
- **Apply to all sections** action
- **Create variation** action
- **Return to course plan** action

This is the highest-value UX improvement still needed for daily teaching.

### Priority 2 — simplify teacher screens
- hide passing periods by default
- move technical schedule controls behind progressive disclosure
- make Today's Plan the default working surface
- remove duplicate navigation/actions where possible

### Priority 3 — announcements
- central announcement composer
- targeting controls
- course/section propagation

### Priority 4 — final classroom readiness pass
Run a simulated teaching day in Demo Mode:
- before school
- first period
- passing period
- later class
- early-release day
- no-school day
- after school

Fix anything that forces unnecessary teacher intervention.

---

## Explicitly post-day-one

These are valuable but should not delay a reliable classroom launch.

### Assessment orchestration and insights
- entrance/exit ticket references
- launch correct Google Form from lesson
- retrieve auto-graded results
- question-level/class-level summary
- reteach/targeted-support thresholds
- standards/learning-target aggregation

### Year rollover wizard
The architecture should support rollover now, but a polished wizard can follow 1.0.

Future workflow:
- create new year
- import calendar
- confirm bell schedules
- choose course templates
- copy prior sequence
- map sections
- review exceptions

### Mobile polish
Maintain responsive foundations, but defer dedicated mobile workflows.

Initial future mobile goals:
- view today's plan
- preview lessons
- light editing
- capture a quick idea/resource

### Present Mode remote control
Potential future mobile companion:
- next/previous
- timer control
- presentation state

Not required for 1.0.

### Analytics / longitudinal insight
- skill trends
- class/section comparisons
- standards mastery over time
- intervention history

### Deeper automation
- snow-day pacing suggestions
- automatic sequence shifting
- proactive resource suggestions
- assessment-driven grouping recommendations

---

## Three long-term product pillars

### Plan
- reusable course templates
- course-first planning
- resources
- calendar/schedule automation

### Teach
- Present Mode
- routines/timers
- announcements
- right resource/assessment at the right moment

### Reflect
- assessment results
- learning-target insight
- reteach signals
- section variance/pacing decisions

Falcon Deck becomes materially more valuable when all three connect, but 1.0 prioritizes **Plan + Teach** reliability first.

---

## Feature-priority filter

Before day one, a proposed feature should pass this test:

**Does this help the teacher teach tomorrow with less friction or greater reliability?**

If yes: consider it for 1.0.

If not: backlog it unless it is necessary architectural work that prevents expensive rework.

---

## Release gate

Falcon Deck 1.0 is ready when:
- a full simulated day succeeds without manual schedule correction
- course lesson duplication is eliminated for normal multi-section teaching
- section variance works without damaging shared content
- no-school/special-schedule behavior is correct
- Present Mode reliably shows the right content
- all critical changes survive reload
- a teacher can identify the next action on primary screens within roughly five seconds
