export default function HomePage() {
  return (
    <main className="container mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">
          Parallel Research
        </h1>
        <p className="mt-2 text-muted-foreground">
          Deep research across Claude, ChatGPT, Mistral, and Gemini. They
          critique each other. You get one synthesized answer.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Scaffold ready. Key panel and research input come next.
        </p>
      </section>
    </main>
  );
}
