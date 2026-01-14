import Chat from "@/components/Chat";

export default function Page() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Autonomous Auto Agent (v1)</h1>
          <p className="mt-1 text-sm text-neutral-300">
            Intent-driven, taste-aware automotive agent prototype. Chat + state machine + artifacts.
          </p>
        </div>
        <Chat />
      </div>
    </main>
  );
}
