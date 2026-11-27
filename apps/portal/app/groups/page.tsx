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
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <h1 className="mt-3 font-display text-4xl">{await screenText("groups")}</h1>
      <p className="mt-3 max-w-xl font-body text-sm text-ink/70">
        To message several numbers at once, open the inbox, choose New, and press Enter after each
        number.
      </p>
      <ul className="tape mt-8 font-body">
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
