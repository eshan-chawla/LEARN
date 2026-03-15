import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-stone-200 pb-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">Smart Learn</div>
            <div className="mt-1 text-sm text-stone-600">AI-native learning management for students</div>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              href="/signin"
              className="rounded-full px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Start Free
            </Link>
          </nav>
        </header>

        <section className="grid gap-12 py-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Built for actual study workflows</p>
            <h1 className="mt-5 text-5xl font-black leading-[0.95] tracking-tight text-slate-950 sm:text-6xl">
              One class space for the lecture, the reading, your notes, and the answer you need later.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-stone-700">
              Smart Learn helps students keep course material in one place, then turns that material into clean context for
              AI-powered retrieval. No more digging across folders, chats, and scattered links the night before an exam.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/signup"
                className="rounded-2xl bg-slate-950 px-7 py-3.5 text-center text-base font-semibold text-white transition hover:bg-slate-800"
              >
                Create your workspace
              </Link>
              <Link
                href="/signin"
                className="rounded-2xl border border-stone-300 px-7 py-3.5 text-center text-base font-semibold text-stone-700 transition hover:bg-stone-100"
              >
                Sign in
              </Link>
            </div>

            <dl className="mt-10 space-y-5 border-l border-stone-200 pl-5">
              <div>
                <dt className="text-sm font-semibold text-slate-900">After class</dt>
                <dd className="mt-1 text-sm leading-7 text-stone-600">Drop in the recording and reading packet for one subject instead of losing them across tools.</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-900">While studying</dt>
                <dd className="mt-1 text-sm leading-7 text-stone-600">Keep your own markdown notes beside the official class material, not in a separate app.</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-900">Before the exam</dt>
                <dd className="mt-1 text-sm leading-7 text-stone-600">Use AI retrieval against the exact class content instead of trusting vague summaries with no source context.</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-[30px] border border-stone-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.08)]">
            <div className="border-b border-stone-200 px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Smart Learn Workspace</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-950">Biology 201</h2>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Ready for retrieval
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-slate-950 px-3 py-1 text-white">Books</span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-700">Recordings</span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-700">Notes</span>
              </div>
            </div>

            <div className="grid gap-6 px-6 py-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Reading packet</p>
                  <h3 className="mt-2 text-base font-semibold text-slate-950">Photosynthesis Foundations.pdf</h3>
                  <p className="mt-1 text-sm text-stone-600">Pages 12-18 assigned for the next lab discussion.</p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Lecture recording</p>
                  <h3 className="mt-2 text-base font-semibold text-slate-950">Week 4: Light Reactions</h3>
                  <p className="mt-1 text-sm text-stone-600">Professor explains the exam framing at 12:40 and again at 31:05.</p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Your note</p>
                  <p className="mt-2 text-sm leading-7 text-stone-700">
                    Need to remember the difference between light-dependent reactions and the Calvin cycle.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950 p-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Ask Smart Learn</p>
                <h3 className="mt-2 text-xl font-bold">What should I review before the quiz on photosynthesis?</h3>
                <div className="mt-5 rounded-2xl bg-white/8 p-4">
                  <p className="text-sm leading-7 text-slate-100">
                    Focus on the two-stage flow. The reading packet explains the inputs and outputs on page 14, and the lecture
                    clarifies how that maps to the quiz format around 12:40.
                  </p>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-xl border border-white/10 px-4 py-3">
                    <p className="font-medium text-white">Source 1</p>
                    <p className="mt-1 text-slate-300">Photosynthesis Foundations.pdf, page 14</p>
                  </div>
                  <div className="rounded-xl border border-white/10 px-4 py-3">
                    <p className="font-medium text-white">Source 2</p>
                    <p className="mt-1 text-slate-300">Week 4: Light Reactions, timestamp 12:40</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
