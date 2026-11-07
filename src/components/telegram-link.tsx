"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateTelegramLinkCode, unlinkTelegramFromMember } from "@/lib/actions";

/**
 * Connect or disconnect a member's Telegram account.
 *
 * The code is shown once, here, and expires in 15 minutes. It is not
 * stored in the page or re-shown on reload: a code sitting on a screen
 * is the weakest part of this, since the web app has no login and anyone
 * with the household URL can mint one.
 */
export function TelegramLink({
  householdId,
  memberId,
  memberName,
  linkedAt,
}: {
  householdId: string;
  memberId: string;
  memberName: string;
  /** When set, this member already has a Telegram account attached. */
  linkedAt: Date | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateTelegramLinkCode(householdId, memberId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode(result.code);
      setExpiresAt(new Date(result.expiresAt));
      router.refresh();
    });
  }

  function unlink() {
    setError(null);
    startTransition(async () => {
      const result = await unlinkTelegramFromMember(householdId, memberId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmingUnlink(false);
      setCode(null);
      router.refresh();
    });
  }

  if (linkedAt) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Telegram</h2>
        <p className="mt-1 text-sm text-slate-700">
          Connected since{" "}
          {linkedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.
          {" "}
          {memberName} can log expenses from the chat.
        </p>

        {confirmingUnlink ? (
          <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">Disconnect Telegram for {memberName}?</p>
            <p className="mt-1 text-xs text-slate-500">
              The bot stops accepting expenses from that account. Expenses already logged are unaffected. You can
              reconnect any time with a new code.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirmingUnlink(false)}
                disabled={isPending}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={unlink}
                disabled={isPending}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {isPending ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingUnlink(true)}
            className="mt-3 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Disconnect Telegram
          </button>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Telegram</h2>
      <p className="mt-1 text-sm text-slate-500">
        Log expenses from a Telegram chat. Generate a code, then send the bot{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/link CODE</code>.
      </p>

      {code ? (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Send this to the bot</p>
          <p className="mt-1 select-all font-mono text-2xl font-semibold tracking-[0.2em] text-emerald-900">
            {code}
          </p>
          <p className="mt-2 text-xs text-emerald-800">
            {`/link ${code}`} — valid until{" "}
            {expiresAt?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (15 minutes), and only
            once.
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            It is shown only now; reload and you will need a new one.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={isPending}
          className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "Generating..." : "Generate link code"}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
