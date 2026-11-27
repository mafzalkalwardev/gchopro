import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { listSharedTemplates } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { SharedTemplateForm } from "./template-form";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await requireDesk();
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const rows = await listSharedTemplates(token);
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">{await screenText("shared_templates")}</h1>
        <ul className="tape mt-8">
          {rows.templates.map((template) => (
            <li key={template.id}>
              <p className="font-body">
                {template.name} · {template.kind}
              </p>
              <p className="mt-2 whitespace-pre-wrap font-body">{template.body}</p>
              <p className="mt-2 font-mono text-xs">
                {template.encoding} · {template.segments} · {template.variables.join(", ")}
              </p>
            </li>
          ))}
        </ul>
        <SharedTemplateForm />
      </section>
    </main>
  );
}
