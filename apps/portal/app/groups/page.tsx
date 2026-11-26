import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { listContactGroups, listContacts, listPortalNotices } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { GroupEditor } from "./group-editor";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const groups = await listContactGroups(token);
  const contacts = await listContacts(token);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("groups")}</h1>
      <PortalNav unread={unread} />
      <ul className="mt-8 max-w-xl space-y-2 font-body">
        {groups.groups.map((group) => (
          <li key={group.id}>
            {group.name} · {group.contactIds.length} members
          </li>
        ))}
      </ul>
      <GroupEditor
        contacts={contacts.contacts.map((contact) => ({ id: contact.id, name: contact.name }))}
      />
    </main>
  );
}
