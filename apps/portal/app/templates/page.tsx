import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { listPortalNotices, listPortalTemplates } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { TemplateForm } from "./template-form";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const rows = await listPortalTemplates(token);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <p className="font-body text-sm">
        <a href="/settings">Settings</a>
      </p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("templates")}</h1>
      <ul className="tape mt-8">
        {rows.templates.map((template) => (
          <li key={template.id}>
            <p className="font-body">
              {template.name} · {template.kind}
              {template.shared ? " · shared" : ""}
            </p>
            <p className="mt-2 whitespace-pre-wrap font-body text-ink/80">{template.body}</p>
            <p className="mt-2 font-mono text-xs">
              {template.encoding} · {template.segments} segments
            </p>
          </li>
        ))}
      </ul>
      <TemplateForm />
    </main>
  );
}
