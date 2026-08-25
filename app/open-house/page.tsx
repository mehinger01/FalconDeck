"use client";

import { useEffect, useMemo, useState } from "react";

const ROTATE_MS = 18000;

const slides = [
  {
    eyebrow: "Welcome, Falcon families",
    title: "Welcome to Mr. Ehinger’s Math Classroom",
    subtitle: "Algebra 1 • Geometry • Ogemaw Heights High School",
    body: "A classroom built around clear routines, productive struggle, steady practice, and the belief that mathematical confidence grows one successful step at a time.",
    kind: "welcome",
  },
  {
    eyebrow: "Meet your teacher",
    title: "A full-circle return to OHHS",
    subtitle: "Teacher • Learner • Builder • Falcon alum",
    body: "I’m excited to be back in these halls teaching math. My background includes math and science education, school leadership, technology, and a lot of hands-on learning outside the classroom too.",
    kind: "profile",
  },
  {
    eyebrow: "What class will feel like",
    title: "Learn it. Practice it. Use it.",
    subtitle: "Clear explanations + lots of reps + support when you need it",
    body: "Students will see a predictable rhythm: warm-up, focused instruction, guided practice, independent work, checks for understanding, and chances to revisit skills until they stick.",
    kind: "pillars",
  },
  {
    eyebrow: "Our classroom promise",
    title: "You do not have to be a ‘math person’ to get better at math.",
    subtitle: "Effort matters. Strategy matters. Asking for help matters.",
    body: "Mistakes are information, not a verdict. We will use them to figure out the next move, strengthen foundations, and build confidence over time.",
    kind: "quote",
  },
  {
    eyebrow: "How families can help",
    title: "Three questions that move learning forward",
    subtitle: "Keep the conversation simple and specific",
    body: "Ask: What did you learn today? What are you practicing next? What do you need help with? Those three questions tell us far more than ‘Do you have homework?’",
    kind: "family",
  },
  {
    eyebrow: "Before you go",
    title: "Come say hello.",
    subtitle: "I’d love to meet you and hear what helps your student learn best.",
    body: "Thank you for being here today. Strong classrooms are built through partnership, communication, and a shared belief that students can grow.",
    kind: "closing",
  },
] as const;

export default function OpenHousePage() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const [portraitSrc, setPortraitSrc] = useState("/open-house/mike-ehinger.jpg");

  const current = slides[index];
  const total = slides.length;

  const go = (next: number) => {
    setIndex((next + total) % total);
    setProgressKey((k) => k + 1);
  };

  const next = () => go(index + 1);
  const previous = () => go(index - 1);

  useEffect(() => {
    let cancelled = false;
    fetch("/open-house/mike-ehinger-hq.b64", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Portrait request failed: ${response.status}`);
        return response.text();
      })
      .then((base64) => {
        if (!cancelled && base64.trim()) {
          setPortraitSrc(`data:image/jpeg;base64,${base64.trim()}`);
        }
      })
      .catch(() => {
        // Keep the bundled JPG fallback if the HQ payload cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((currentIndex) => (currentIndex + 1) % total);
      setProgressKey((k) => k + 1);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, total, progressKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") previous();
      if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      }
      if (event.key.toLowerCase() === "f") {
        document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const accent = useMemo(() => {
    switch (current.kind) {
      case "quote":
        return "border-falcon-gold-400/70 bg-falcon-brown-900/70";
      case "closing":
        return "border-falcon-gold-300/70 bg-falcon-brown-800/70";
      default:
        return "border-falcon-gold-500/50 bg-falcon-brown-900/62";
    }
  }, [current.kind]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-falcon-brown-950 text-falcon-cream-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(201,162,39,0.18),transparent_34%),radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.06),transparent_28%),linear-gradient(135deg,#21140b_0%,#2f1d10_55%,#21140b_100%)]" />
      <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:42px_42px]" />

      <section className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="relative flex min-h-[42vh] items-center justify-center overflow-hidden px-6 pb-2 pt-8 sm:px-10 lg:min-h-screen lg:px-10 lg:py-10 xl:px-14">
          <div className="relative flex w-full max-w-[780px] items-end justify-center">
            <img
              src={portraitSrc}
              alt="Illustrated portrait of Mr. Ehinger with interests including chess, mountains, AI, guitar, woodworking, tools, and a car"
              className="h-auto w-full max-w-[760px] object-contain drop-shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-falcon-brown-950 via-falcon-brown-950/55 to-transparent lg:h-36" />
          <div className="absolute bottom-4 left-4 z-10 rounded-2xl border border-white/15 bg-falcon-brown-950/78 px-4 py-3 backdrop-blur-md lg:bottom-8 lg:left-8">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-falcon-gold-300">Falcon Deck • Open House</div>
            <div className="mt-1 text-xl font-semibold">Mr. Ehinger</div>
            <div className="text-sm text-falcon-cream-300">Algebra 1 & Geometry</div>
          </div>
        </div>

        <div className="flex min-h-[58vh] flex-col justify-between px-6 py-7 sm:px-10 lg:min-h-screen lg:px-14 lg:py-10 xl:px-20">
          <header className="flex items-center justify-between gap-4">
            <div className="text-sm font-bold uppercase tracking-[0.24em] text-falcon-gold-400">Ogemaw Heights High School</div>
            <div className="rounded-full border border-falcon-gold-400/35 bg-falcon-gold-400/10 px-3 py-1 text-xs font-semibold text-falcon-gold-300">
              {index + 1} / {total}
            </div>
          </header>

          <div key={index} className={`my-8 animate-present-fade rounded-[2rem] border p-6 shadow-2xl backdrop-blur-sm sm:p-8 lg:p-10 ${accent}`}>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-falcon-gold-300">{current.eyebrow}</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl">
              {current.title}
            </h1>
            <p className="mt-5 max-w-3xl text-lg font-semibold leading-relaxed text-falcon-gold-300 sm:text-xl lg:text-2xl">
              {current.subtitle}
            </p>
            <p className="mt-5 max-w-3xl text-base leading-relaxed text-falcon-cream-200 sm:text-lg lg:text-xl">
              {current.body}
            </p>

            {current.kind === "pillars" && (
              <div className="mt-7 grid grid-cols-2 gap-3 text-sm font-semibold sm:grid-cols-4 sm:text-base">
                {["Warm-up", "Teach", "Practice", "Check"].map((item) => (
                  <div key={item} className="rounded-xl border border-falcon-gold-400/25 bg-white/5 px-4 py-3 text-center">
                    {item}
                  </div>
                ))}
              </div>
            )}

            {current.kind === "family" && (
              <div className="mt-7 grid gap-3 text-sm font-semibold sm:grid-cols-3 sm:text-base">
                {["What did you learn?", "What comes next?", "What help do you need?"].map((item) => (
                  <div key={item} className="rounded-xl border border-falcon-gold-400/25 bg-white/5 px-4 py-3 text-center">
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer>
            <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/10">
              {!paused && (
                <div
                  key={progressKey}
                  className="h-full origin-left bg-falcon-gold-400"
                  style={{ animation: `openHouseProgress ${ROTATE_MS}ms linear forwards` }}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-falcon-cream-300">
              <div className="font-medium">Learn • Practice • Improve • Repeat</div>
              <div className="flex items-center gap-2">
                <button onClick={previous} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 hover:bg-white/10" aria-label="Previous slide">←</button>
                <button onClick={() => setPaused((value) => !value)} className="rounded-lg border border-falcon-gold-400/30 bg-falcon-gold-400/10 px-4 py-2 font-semibold text-falcon-gold-300 hover:bg-falcon-gold-400/15">
                  {paused ? "Resume" : "Pause"}
                </button>
                <button onClick={next} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 hover:bg-white/10" aria-label="Next slide">→</button>
                <button onClick={() => document.documentElement.requestFullscreen?.()} className="hidden rounded-lg border border-white/15 bg-white/5 px-3 py-2 hover:bg-white/10 sm:block">
                  Full screen
                </button>
              </div>
            </div>
          </footer>
        </div>
      </section>

      <style jsx global>{`
        @keyframes openHouseProgress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="openHouseProgress"] { animation: none !important; }
        }
      `}</style>
    </main>
  );
}
