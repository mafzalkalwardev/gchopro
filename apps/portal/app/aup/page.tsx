import { SAFE_TEXT } from "@gchopro/core";
import { screenText } from "@/lib/copy";

const TERMS =
  "Messages may only be sent to recipients who have consented or have an existing relationship with the sender. Purchased or scraped lists are prohibited. Recipients can reply STOP or 退订 to opt out at any time. Operation must comply with local telecommunications regulations (for example the Pakistan Telecommunication Authority where applicable) and the terms of service of each carrier.";

export const dynamic = "force-dynamic";

function notice(reason: string | undefined): string {
  if (reason === undefined || !(reason in SAFE_TEXT)) return "";
  return SAFE_TEXT[reason as keyof typeof SAFE_TEXT];
}

export default async function AupPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const query = await searchParams;
  const text = notice(query.reason);
  return (
    <main className="gate bg-paper text-ink">
      <section className="w-full max-w-lg border border-ink/15 px-5 py-8 sm:px-8">
        <h1 className="font-display text-3xl">{await screenText("aup")}</h1>
        <p className="mt-4 font-body">{TERMS}</p>
        <form className="mt-6" method="post" action="/api/portal/aup">
          <button className="w-full bg-ink font-body text-paper" type="submit">
            Accept
          </button>
        </form>
        {text.length > 0 ? <p className="mt-3 font-body text-sm text-signal">{text}</p> : null}
      </section>
    </main>
  );
}
