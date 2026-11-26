"use client";

import { useState, type FormEvent } from "react";

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
}: {
  to?: string;
  templates: { id: string; name: string; shared: boolean }[];
}) {
  const [body, setBody] = useState("");
  const [peer, setPeer] = useState(to ?? "");
  const [templateId, setTemplateId] = useState("");
  const [when, setWhen] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  function payload() {
    return {
      to: peer,
      body: body.length > 0 ? body : "Hello",
      templateId: templateId.length > 0 ? templateId : undefined,
      scheduledFor: when.length > 0 ? new Date(when).toISOString() : undefined,
    };
  }

  async function post(path: string): Promise<Payload> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify(payload()),
    });
    return (await response.json()) as Payload;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const result = await post("/api/portal/messages");
    if (result.error) {
      setError(result.message ?? "The message was not accepted.");
      return;
    }
    const id = result.data?.conversationId ?? result.data?.message?.conversationId;
    if (id) window.location.href = `/c/${id}`;
  }

  return (
    <form className="mt-8 grid max-w-xl gap-3" onSubmit={(event) => void send(event)}>
      {to === undefined ? (
        <label className="grid gap-1 font-body text-sm">
          To
          <input
            className="border border-ink/20 bg-paper px-3 py-2 font-mono"
            value={peer}
            onChange={(event) => setPeer(event.target.value)}
            required
          />
        </label>
      ) : null}
      <label className="grid gap-1 font-body text-sm">
        Template
        <select
          className="border border-ink/20 bg-paper px-3 py-2"
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
      <label className="grid gap-1 font-body text-sm">
        Message
        <textarea
          className="min-h-32 border border-ink/20 bg-paper px-3 py-2"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required={templateId.length === 0}
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Schedule
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
      </label>
      <div className="flex gap-3">
        <button className="border border-ink px-4 py-2 font-body" type="submit">
          Send
        </button>
        <button
          className="border border-ink/20 px-4 py-2 font-body"
          type="button"
          onClick={() => {
            void post("/api/portal/messages/preview").then((result) => {
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
      </div>
      {preview.length > 0 ? <p className="font-mono text-sm">{preview}</p> : null}
      {error.length > 0 ? <p className="font-body text-signal">{error}</p> : null}
    </form>
  );
}

export function GroupForm() {
  const [recipients, setRecipients] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/portal/group-sends", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        recipients: recipients
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        body,
      }),
    });
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
      data?: { id?: string };
    };
    if (!response.ok || payload.error) {
      setError(payload.message ?? "The group was not accepted.");
      return;
    }
    if (payload.data?.id) window.location.href = `/groups/sends/${payload.data.id}`;
  }

  return (
    <form className="mt-8 grid max-w-xl gap-3" onSubmit={(event) => void send(event)}>
      <label className="grid gap-1 font-body text-sm">
        Recipients, one number per line
        <textarea
          className="min-h-24 border border-ink/20 bg-paper px-3 py-2 font-mono"
          value={recipients}
          onChange={(event) => setRecipients(event.target.value)}
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Message
        <textarea
          className="min-h-32 border border-ink/20 bg-paper px-3 py-2"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
        />
      </label>
      <button className="w-fit border border-ink px-4 py-2 font-body" type="submit">
        Send group
      </button>
      {error.length > 0 ? <p className="font-body text-signal">{error}</p> : null}
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
            className="font-mono text-xs underline"
            type="button"
            onClick={() => setSide("original")}
          >
            Original
          </button>
          <button
            className="font-mono text-xs underline"
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
      className="mt-2 font-body text-sm underline"
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

export function CancelButton({ id }: { id: string }) {
  return (
    <button
      className="mt-2 font-mono text-xs underline"
      type="button"
      onClick={() => {
        void fetch(`/api/portal/messages/${id}/cancel`, {
          method: "POST",
          headers: { "x-csrf-token": csrf() },
        }).then((response) => {
          if (response.ok) window.location.reload();
        });
      }}
    >
      Cancel
    </button>
  );
}
