import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listPortalTemplates } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { requirePortal } from "@/lib/gate";
import { Composer } from "./composer";
import { Messages } from "./messages";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; tag?: string }>;
}) {
  await requirePortal();
  const query = await searchParams;
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const templates = await listPortalTemplates(token);
  return (
    <Messages
      query={query}
      pane={
        <>
          <h2 className="sr-only">{await screenText("new_message")}</h2>
          <Composer templates={templates.templates} />
        </>
      }
    />
  );
}
