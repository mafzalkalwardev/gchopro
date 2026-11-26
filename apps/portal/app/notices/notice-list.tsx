"use client";

import { useState } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function NoticeList({
  notices,
}: {
  notices: { id: string; title: string; body: string; read: boolean }[];
}) {
  const [rows, setRows] = useState(notices);

  async function mark(id: string) {
    const response = await fetch(`/api/portal/notices/${id}/read`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
    });
    if (!response.ok) return;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, read: true } : row)));
  }

  return (
    <ul className="mt-6 grid gap-4">
      {rows.map((notice) => (
        <li key={notice.id} className="border border-ink/15 p-4">
          <h2 className="font-display text-2xl">
            {notice.title}
            {notice.read ? null : (
              <span className="ml-2 inline-block h-2 w-2 bg-signal" aria-label="unread" />
            )}
          </h2>
          <p className="mt-2 font-body">{notice.body}</p>
          {notice.read ? null : (
            <button
              className="mt-3 border border-ink px-3 py-2"
              type="button"
              onClick={() => void mark(notice.id)}
            >
              Mark read
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
