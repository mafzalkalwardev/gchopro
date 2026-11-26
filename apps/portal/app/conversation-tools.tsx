"use client";

import { FormEvent } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function ConversationTools({
  id,
  archived,
  tags,
}: {
  id: string;
  archived: boolean;
  tags: string[];
}) {
  const locale = useLocale();

  async function save(body: { archived?: boolean; tags?: string[] }) {
    await fetch(`/api/portal/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify(body),
    });
    window.location.reload();
  }

  function onTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tag = String(form.get("tag") ?? "").trim();
    if (tag.length === 0) return;
    void save({ tags: [...tags, tag] });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 font-body text-sm">
      <button
        className="border border-ink px-3 py-2"
        type="button"
        onClick={() => void save({ archived: !archived })}
      >
        {screenCopy(locale, archived ? "unarchive" : "archive")}
      </button>
      <form className="flex gap-2" onSubmit={onTag}>
        <input className="border border-ink bg-paper px-3 py-2" name="tag" maxLength={40} />
        <button className="border border-ink px-3 py-2" type="submit">
          {screenCopy(locale, "tag")}
        </button>
      </form>
    </div>
  );
}
