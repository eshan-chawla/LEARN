import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.18),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_52%,_#f8fafc_100%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between rounded-full border border-white/70 bg-white/75 px-5 py-3 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700">Smart Learn</div>
            <div className="text-sm text-slate-500">AI-native learning management</div>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              href="/signin"
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
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

        <section className="relative grid gap-10 pb-16 pt-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pt-20">
          <div>
            <div className="inline-flex items-center rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-sky-700 shadow-sm">
              Built for students first
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.95] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              The AI-native LMS that makes studying feel organized instead of overwhelming.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Smart Learn brings class recordings, books, notes, and AI-ready knowledge retrieval into one clean workspace,
              so students spend less time hunting for material and more time actually learning.
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
                className="rounded-2xl border border-slate-200 bg-white/90 px-7 py-3.5 text-center text-base font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Explore your dashboard
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                <div className="text-3xl font-black text-slate-950">1</div>
                <p className="mt-2 text-sm text-slate-600">Unified place for notes, books, and class recordings.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                <div className="text-3xl font-black text-slate-950">AI</div>
                <p className="mt-2 text-sm text-slate-600">Structured content ready for semantic search and study assistance.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                <div className="text-3xl font-black text-slate-950">Fast</div>
                <p className="mt-2 text-sm text-slate-600">Designed to reduce context switching for students managing multiple classes.</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 translate-x-4 translate-y-6 rounded-[32px] bg-sky-200/40 blur-3xl" />
            <div className="relative rounded-[32px] border border-white/80 bg-slate-950 p-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">Student Workspace</p>
                  <h2 className="mt-2 text-2xl font-bold">Everything for one class, finally in one place.</h2>
                </div>
                <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">Live structure</div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="rounded-2xl bg-white/8 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">AI-ready books</p>
                      <p className="mt-1 text-sm text-slate-300">Upload PDFs, organize by section, and keep titles clean in the UI.</p>
                    </div>
                    <div className="rounded-xl bg-amber-300/20 px-3 py-1 text-xs font-semibold text-amber-200">Books</div>
                  </div>
                </div>
                <div className="rounded-2xl bg-white/8 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Recorded classes</p>
                      <p className="mt-1 text-sm text-slate-300">Store videos alongside the rest of the class context instead of scattered links.</p>
                    </div>
                    <div className="rounded-xl bg-sky-300/20 px-3 py-1 text-xs font-semibold text-sky-200">Recordings</div>
                  </div>
                </div>
                <div className="rounded-2xl bg-white/8 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Private markdown notes</p>
                      <p className="mt-1 text-sm text-slate-300">Each student keeps personal notes inside the same class workspace.</p>
                    </div>
                    <div className="rounded-xl bg-emerald-300/20 px-3 py-1 text-xs font-semibold text-emerald-200">Notes</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Why it works</p>
                  <p className="mt-2 text-sm text-slate-200">Classes stay structured by design, so AI retrieval later has clean, scoped context.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">For students</p>
                  <p className="mt-2 text-sm text-slate-200">Less time searching across tools. More time reviewing what matters before class and exams.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 pb-20 md:grid-cols-3">
          <article className="rounded-[28px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-sky-700">Capture</p>
            <h3 className="mt-3 text-2xl font-bold text-slate-950">Bring every learning asset together</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Import PDFs, upload recordings, and keep notes inside the exact class they belong to instead of across disconnected apps.
            </p>
          </article>
          <article className="rounded-[28px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-orange-700">Organize</p>
            <h3 className="mt-3 text-2xl font-bold text-slate-950">Keep coursework readable and structured</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Sections, tables, and class-specific access control keep study material easy to scan for both teachers and students.
            </p>
          </article>
          <article className="rounded-[28px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-700">Retrieve</p>
            <h3 className="mt-3 text-2xl font-bold text-slate-950">Prepare for AI-powered study flows</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Smart Learn is built to make class content AI-ready, so search, summarization, and future learning copilots have better context.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
