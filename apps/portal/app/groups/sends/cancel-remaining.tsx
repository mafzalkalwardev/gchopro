"use client";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function CancelRemaining({ id }: { id: string }) {
  return (
    <form
      method="post"
      action={`/api/portal/group-sends/${id}/cancel`}
      onSubmit={(event) => {
        event.preventDefault();
        void fetch(`/api/portal/group-sends/${id}/cancel`, {
          method: "POST",
          headers: { "x-csrf-token": csrf() },
        }).then((response) => {
          if (response.ok) window.location.reload();
        });
      }}
    >
      <input type="hidden" name="next" value={`/groups/sends/${id}`} />
      <button className="mt-6 border border-ink px-4 py-2 font-body" type="submit">
        Cancel remaining
      </button>
    </form>
  );
}
