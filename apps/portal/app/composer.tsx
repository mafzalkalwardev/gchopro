"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

type Payload = {
  error?: string;
  message?: string;
  data?: {
    text?: string;
    segments?: number;
    encoding?: string;
    preview?: { segments?: number; encoding?: string };
    conversationId?: string;
    message?: { conversationId?: string };
  };
};

export function Composer({
  to,
  templates,
  returnTo = "/",
}: {
  to?: string;
  templates: { id: string; name: string; shared: boolean }[];
  returnTo?: string;
}) {
  const [body, setBody] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [when, setWhen] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  function numbers(): string[] {
    if (to !== undefined) return [to];
    const pending = draft.trim();
    const all = pending.length > 0 && !chips.includes(pending) ? [...chips, pending] : chips;
    return all;
  }

  function addChip(raw: string) {
    const next = raw.trim().replace(/,$/u, "");
    if (next.length === 0 || chips.includes(next)) {
      setDraft("");
      return;
    }
    setChips((current) => [...current, next]);
    setDraft("");
  }

  function onToKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addChip(draft);
      return;
    }
    if (event.key === "Backspace" && draft.length === 0) {
      setChips((current) => current.slice(0, -1));
    }
  }

  function payload(peer: string) {
    return {
      to: peer,
      body: body.length > 0 ? body : "Hello",
      templateId: templateId.length > 0 ? templateId : undefined,
      scheduledFor: when.length > 0 ? new Date(when).toISOString() : undefined,
    };
  }

  async function post(path: string, bodyJson: unknown): Promise<Payload> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify(bodyJson),
    });
    return (await response.json()) as Payload;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const recipients = numbers();
    if (recipients.length === 0) {
      setError("Add a number, then press Enter.");
      return;
    }
    if (recipients.length === 1) {
      const result = await post("/api/portal/messages", payload(recipients[0] ?? ""));
      if (result.error) {
        setError(result.message ?? "The message was not accepted.");
        return;
      }
      const id = result.data?.conversationId ?? result.data?.message?.conversationId;
      if (id) window.location.href = `/c/${id}`;
      return;
    }
    const result = await post("/api/portal/group-sends", {
      recipients,
      body: body.length > 0 ? body : "Hello",
      templateId: templateId.length > 0 ? templateId : undefined,
      scheduledFor: when.length > 0 ? new Date(when).toISOString() : undefined,
    });
    const group = result.data as { id?: string } | undefined;
    if (result.error || group?.id === undefined) {
      setError(result.message ?? "The group was not accepted.");
      return;
    }
    window.location.href = `/groups/sends/${group.id}`;
  }

  return (
    <form
      className="grid content-start"
      method="post"
      action="/api/portal/messages"
      onSubmit={(event) => void send(event)}
    >
      <input type="hidden" name="next" value={returnTo} />
      {to === undefined ? (
        <label className="flex min-h-11 flex-wrap items-center gap-2 border-b border-ink/15 px-1 py-2 font-body text-sm">
          <span>To</span>
          {chips.map((chip) => (
            <button
              key={chip}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink/10 px-3 font-mono text-sm"
              type="button"
              aria-label={`Remove ${chip}`}
              onClick={() => setChips((current) => current.filter((item) => item !== chip))}
            >
              {chip}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <input
            className="min-h-11 min-w-40 flex-1 border-0 bg-transparent px-1 font-mono outline-none"
            name="to"
            value={draft}
            placeholder="Number, then Enter"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onToKeyDown}
            required={chips.length === 0}
          />
        </label>
      ) : (
        <input type="hidden" name="to" value={to} />
      )}
      <div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-ink/15 pt-3">
          <label className="grid min-w-0 flex-1">
            <span className="sr-only">Message</span>
            <textarea
              className="min-h-11 rounded-3xl border border-ink/20 bg-paper px-4 py-2"
              name="body"
              rows={1}
              placeholder="Text message"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required={templateId.length === 0}
            />
          </label>
          <button className="min-h-11 rounded-full bg-ink px-4 font-body text-paper" type="submit">
            Send
          </button>
        </div>
        <details className="font-body text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-ink/70">
            Template and schedule
          </summary>
          <label className="mt-2 grid gap-1">
            Template
            <select
              className="rounded-2xl border border-ink/20 bg-paper px-3 py-2"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">None</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.shared ? "Shared: " : ""}
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 grid gap-1">
            Schedule
            <input
              className="rounded-2xl border border-ink/20 bg-paper px-3 py-2"
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </label>
          <button
            className="mt-3 min-h-11 px-1 font-body text-sm"
            type="button"
            onClick={() => {
              const peer = numbers()[0];
              void post("/api/portal/messages/preview", payload(peer ?? "")).then((result) => {
                if (result.error) {
                  setError(result.message ?? "Preview failed.");
                  return;
                }
                const view = result.data;
                if (view?.segments !== undefined) {
                  const text = view.text ?? "";
                  setPreview(
                    text.length > 0
                      ? `${text}\n${view.encoding ?? ""} · ${view.segments} segments`
                      : `${view.encoding ?? ""} · ${view.segments} segments`,
                  );
                }
              });
            }}
          >
            Preview
          </button>
        </details>
        {preview.length > 0 ? <p className="font-mono text-sm">{preview}</p> : null}
        {error.length > 0 ? <p className="font-body text-signal">{error}</p> : null}
      </div>
    </form>
  );
}

export function TranslationToggle(props: {
  original: string;
  translated: string | null;
  preferred: "original" | "translated";
  unavailable: boolean;
}) {
  const [side, setSide] = useState(props.preferred);
  const same = props.translated === null || props.translated === props.original;
  const text =
    !same && side === "translated" && props.translated !== null ? props.translated : props.original;
  return (
    <>
      <p className="mt-2 whitespace-pre-wrap font-body">{text}</p>
      {props.unavailable ? (
        <p className="mt-2 font-body text-sm">Translation unavailable.</p>
      ) : null}
      {same ? null : (
        <div className="mt-2 flex gap-3">
          <button
            className="border border-ink/30 px-3 font-mono text-xs"
            type="button"
            onClick={() => setSide("original")}
          >
            Original
          </button>
          <button
            className="border border-ink/30 px-3 font-mono text-xs"
            type="button"
            onClick={() => setSide("translated")}
          >
            Translated
          </button>
        </div>
      )}
    </>
  );
}

export function SendOriginal({ id }: { id: string }) {
  return (
    <button
      className="mt-2 border border-ink/30 px-3 font-body text-sm"
      type="button"
      onClick={() => {
        void fetch(`/api/portal/messages/${id}/original`, {
          method: "POST",
          headers: { "x-csrf-token": csrf() },
        }).then((response) => {
          if (response.ok) window.location.reload();
        });
      }}
    >
      Send without translation
    </button>
  );
}

export function CancelButton({ id, returnTo = "/" }: { id: string; returnTo?: string }) {
  return (
    <form
      method="post"
      action={`/api/portal/messages/${id}/cancel`}
      onSubmit={(event) => {
        event.preventDefault();
        void fetch(`/api/portal/messages/${id}/cancel`, {
          method: "POST",
          headers: { "x-csrf-token": csrf() },
        }).then((response) => {
          if (response.ok) window.location.reload();
        });
      }}
    >
      <input type="hidden" name="next" value={returnTo} />
      <button className="mt-2 border border-ink/30 px-3 font-mono text-xs" type="submit">
        Cancel
      </button>
    </form>
  );
}
