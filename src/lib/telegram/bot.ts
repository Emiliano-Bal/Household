import { Bot, InlineKeyboard, type Context } from "grammy";
import { prisma } from "../db";
import { formatCents } from "../money";
import { createExpenseRecord } from "../expense-service";
import { parseAmount, parseQuickExpense, amountErrorMessage } from "./parse";
import {
  clearExpiredSessions,
  clearSession,
  loadSession,
  nextStep,
  saveSession,
  type Draft,
  type Step,
} from "./session";
import {
  MAX_FAILED_ATTEMPTS,
  redeemLinkCode,
  resolveLinkedMember,
  unlinkTelegramUser,
  type LinkedMember,
} from "./link";

/**
 * The bot. All user-facing copy is Spanish.
 *
 * One instance is built per cold start and reused: constructing a Bot is
 * cheap, but `init()` costs a getMe round trip to Telegram, so a fresh
 * one per request would add latency to every message.
 */
let cached: { token: string; bot: Bot } | null = null;

export function getBot(token: string): Bot {
  if (cached && cached.token === token) return cached.bot;
  const bot = buildBot(token);
  cached = { token, bot };
  return bot;
}

const NO_CATEGORY = "__none__";

function buildBot(token: string): Bot {
  // botInfo supplied so grammY does not call getMe on first use — in a
  // webhook that round trip is on the critical path of a user's message.
  const bot = new Bot(token);

  bot.catch((err) => {
    console.error("telegram bot error", err.error);
  });

  // ---- Guard: every handler below needs a linked member ---------------
  //
  // Unlinked users are ignored except for /link and /start, so a stranger
  // who finds the bot cannot read or write anything in a household.

  bot.command("start", async (ctx) => {
    const member = await linkedMemberFor(ctx);
    if (member) {
      await ctx.reply(
        `Hola ${member.memberName}. Ya estás vinculado.\n\n` +
          "Usa /gasto para registrar un gasto, o escríbeme directamente algo como:\n" +
          "`45,20 Mercadona`\n\n" +
          "Otros comandos: /ultimos, /cancelar, /desvincular",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await ctx.reply(
      "Hola. Para usar este bot primero tienes que vincular tu cuenta.\n\n" +
        "Abre la app, entra en tu ficha de miembro, genera un código y envíamelo así:\n" +
        "`/link ABCD2345`",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("link", async (ctx) => {
    const telegramUserId = userIdOf(ctx);
    if (telegramUserId === null) return;

    const code = (ctx.match ?? "").toString().trim();
    if (!code) {
      await ctx.reply("Escribe el código después del comando, por ejemplo:\n`/link ABCD2345`", {
        parse_mode: "Markdown",
      });
      return;
    }

    const result = await redeemLinkCode(telegramUserId, code);
    if (result.ok) {
      await ctx.reply(
        `Listo, ${result.memberName}. Tu cuenta de Telegram está vinculada.\n\n` +
          "Usa /gasto para registrar un gasto, o escríbeme `45,20 Mercadona`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    switch (result.reason) {
      case "rate-limited":
        await ctx.reply(
          `Demasiados intentos fallidos. Espera una hora antes de volver a probar ` +
            `(máximo ${MAX_FAILED_ATTEMPTS} por hora).`
        );
        return;
      case "already-linked":
        await ctx.reply("Esta cuenta de Telegram ya está vinculada. Usa /desvincular si quieres cambiarla.");
        return;
      case "member-taken":
        await ctx.reply("Ese miembro ya tiene otra cuenta de Telegram vinculada.");
        return;
      default:
        // invalid / expired / used all say the same thing on purpose: a
        // guesser should not learn that a code existed but had expired.
        await ctx.reply("Ese código no es válido o ha caducado. Genera uno nuevo en la app (caducan a los 15 minutos).");
    }
  });

  bot.command("desvincular", async (ctx) => {
    const telegramUserId = userIdOf(ctx);
    if (telegramUserId === null) return;
    const removed = await unlinkTelegramUser(telegramUserId);
    if (ctx.chat) await clearSession(BigInt(ctx.chat.id));
    await ctx.reply(
      removed
        ? "Cuenta desvinculada. No volveré a aceptar gastos desde aquí hasta que vuelvas a vincularla con /link."
        : "Esta cuenta no estaba vinculada."
    );
  });

  bot.command("cancelar", async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return;
    const had = await clearSession(BigInt(ctx.chat.id));
    await ctx.reply(had ? "Gasto cancelado." : "No hay ningún gasto en curso.");
  });

  bot.command("gasto", async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return;
    await startFlow(ctx, member, {});
  });

  bot.command("ultimos", async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member) return;

    const expenses = await prisma.expense.findMany({
      where: { householdId: member.householdId },
      include: { category: { select: { name: true } }, paidBy: { select: { name: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 5,
    });

    if (expenses.length === 0) {
      await ctx.reply("Todavía no hay gastos registrados.");
      return;
    }

    const lines = expenses.map((e) => {
      const date = e.date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" });
      const category = e.category?.name ?? "Sin categoría";
      return `• ${date} — ${e.label} — ${formatCents(e.amount)}\n  ${category} · pagó ${e.paidBy.name}`;
    });
    await ctx.reply(`Últimos ${expenses.length} gastos:\n\n${lines.join("\n")}`);
  });

  // ---- Inline keyboard callbacks --------------------------------------

  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return void (await ctx.answerCallbackQuery());

    const session = await loadSession(BigInt(ctx.chat.id));
    if (!session) return void (await expiredCallback(ctx));

    const chosen = ctx.match![1];
    if (chosen === NO_CATEGORY) {
      session.draft.categoryId = null;
      session.draft.categoryName = null;
    } else {
      const category = await prisma.category.findFirst({
        where: { id: chosen, householdId: member.householdId },
        select: { id: true, name: true },
      });
      // The category could have been deleted between the keyboard being
      // drawn and tapped.
      if (!category) {
        await ctx.answerCallbackQuery({ text: "Esa categoría ya no existe." });
        await askCategory(ctx, member);
        return;
      }
      session.draft.categoryId = category.id;
      session.draft.categoryName = category.name;
    }

    await ctx.answerCallbackQuery();
    await advance(ctx, member, session.draft);
  });

  bot.callbackQuery(/^split:(SOLO|PROPORTIONAL|EQUAL)$/, async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return void (await ctx.answerCallbackQuery());

    const session = await loadSession(BigInt(ctx.chat.id));
    if (!session) return void (await expiredCallback(ctx));

    session.draft.split = ctx.match![1] as Draft["split"];
    await ctx.answerCallbackQuery();
    await advance(ctx, member, session.draft);
  });

  bot.callbackQuery("confirm", async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return void (await ctx.answerCallbackQuery());

    const session = await loadSession(BigInt(ctx.chat.id));
    if (!session) return void (await expiredCallback(ctx));

    const { title, amountCents, split } = session.draft;
    if (!title || amountCents === undefined || !split) {
      await ctx.answerCallbackQuery();
      await advance(ctx, member, session.draft);
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const expense = await createExpenseRecord({
        householdId: member.householdId,
        date: new Date(),
        label: title,
        amount: amountCents,
        categoryId: session.draft.categoryId ?? undefined,
        paidByMemberId: member.memberId,
        // SOLO is the app's "personal" expense: it never touches
        // household balances, which is what "Solo yo" means here.
        splitRule: split === "SOLO" ? { type: "SOLO" } : { type: split },
        isShared: split !== "SOLO",
      });

      await clearSession(BigInt(ctx.chat.id));
      await ctx.reply(
        `✅ Gasto registrado: *${escapeMarkdown(expense.label)}* — ${formatCents(expense.amount)}\n` +
          `${describeSplit(split)} · pagado por ${escapeMarkdown(member.memberName)}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("telegram: failed to create expense", error);
      await ctx.reply("No he podido guardar el gasto. Inténtalo de nuevo en un momento.");
    }
  });

  bot.callbackQuery("cancel", async (ctx) => {
    if (!ctx.chat) return void (await ctx.answerCallbackQuery());
    await clearSession(BigInt(ctx.chat.id));
    await ctx.answerCallbackQuery();
    await ctx.reply("Gasto cancelado.");
  });

  bot.callbackQuery("new_expense", async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    await startFlow(ctx, member, {});
  });

  // ---- Free text -------------------------------------------------------

  bot.on("message:text", async (ctx) => {
    const member = await requireLinked(ctx);
    if (!member || !ctx.chat) return;

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return; // an unknown command, not an answer

    const chatId = BigInt(ctx.chat.id);
    const session = await loadSession(chatId);

    // No flow running: try the one-line shortcut, otherwise treat the
    // message as the title and ask for the rest.
    if (!session) {
      const quick = parseQuickExpense(text);
      if (quick) {
        await startFlow(ctx, member, { title: quick.title, amountCents: quick.cents });
        return;
      }
      await startFlow(ctx, member, { title: text });
      return;
    }

    const draft = session.draft;
    switch (session.step) {
      case "awaiting_title": {
        // The shortcut still works as an answer to "¿qué has comprado?".
        const quick = parseQuickExpense(text);
        if (quick) {
          draft.title = quick.title;
          draft.amountCents = quick.cents;
        } else {
          draft.title = text;
        }
        break;
      }
      case "awaiting_amount": {
        const amount = parseAmount(text);
        if (!amount.ok) {
          await ctx.reply(amountErrorMessage(amount.reason));
          return; // re-ask without advancing
        }
        draft.amountCents = amount.cents;
        break;
      }
      default:
        // A stray message while a keyboard is pending — nudge rather than
        // silently dropping it.
        await ctx.reply("Usa los botones de arriba, o /cancelar para empezar de nuevo.");
        return;
    }

    await advance(ctx, member, draft);
  });

  return bot;
}

// ---- Flow -------------------------------------------------------------

async function startFlow(ctx: Context, member: LinkedMember, draft: Draft): Promise<void> {
  // Cheap housekeeping on a path that already writes, instead of a cron.
  void clearExpiredSessions().catch(() => {});
  await advance(ctx, member, draft);
}

/**
 * Persists the draft and asks whatever question comes next. One place
 * decides "what is still missing", so the quick format and the long flow
 * cannot drift apart.
 */
async function advance(ctx: Context, member: LinkedMember, draft: Draft): Promise<void> {
  if (!ctx.chat || !ctx.from) return;
  const chatId = BigInt(ctx.chat.id);
  const step: Step = nextStep(draft);
  await saveSession(chatId, BigInt(ctx.from.id), step, draft);

  switch (step) {
    case "awaiting_title":
      await ctx.reply("¿Qué has comprado? Escribe un título corto, por ejemplo: Mercadona");
      return;
    case "awaiting_amount":
      await ctx.reply(`¿Cuánto ha costado *${escapeMarkdown(draft.title ?? "")}*? Por ejemplo: 45,20`, {
        parse_mode: "Markdown",
      });
      return;
    case "awaiting_category":
      await askCategory(ctx, member);
      return;
    case "awaiting_split":
      await ctx.reply("¿Cómo se reparte?", {
        reply_markup: new InlineKeyboard()
          .text("Solo yo", "split:SOLO")
          .row()
          .text("Proporcional al ingreso", "split:PROPORTIONAL")
          .row()
          .text("A partes iguales", "split:EQUAL"),
      });
      return;
    case "awaiting_confirm":
      await ctx.reply(summary(draft, member), {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("Confirmar", "confirm").text("Cancelar", "cancel"),
      });
      return;
  }
}

async function askCategory(ctx: Context, member: LinkedMember): Promise<void> {
  const categories = await prisma.category.findMany({
    where: { householdId: member.householdId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const keyboard = new InlineKeyboard();
  // Two per row: Telegram truncates long labels badly at three, and these
  // are category names, not icons.
  categories.forEach((category, index) => {
    keyboard.text(category.name, `cat:${category.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (categories.length % 2 === 1) keyboard.row();
  keyboard.text("Sin categoría", `cat:${NO_CATEGORY}`);

  await ctx.reply("¿En qué categoría?", { reply_markup: keyboard });
}

function summary(draft: Draft, member: LinkedMember): string {
  return [
    "*Resumen del gasto*",
    "",
    `Título: ${escapeMarkdown(draft.title ?? "")}`,
    `Importe: ${formatCents(draft.amountCents ?? 0)}`,
    `Categoría: ${escapeMarkdown(draft.categoryName ?? "Sin categoría")}`,
    `Reparto: ${describeSplit(draft.split)}`,
    `Pagado por: ${escapeMarkdown(member.memberName)}`,
  ].join("\n");
}

function describeSplit(split: Draft["split"]): string {
  switch (split) {
    case "SOLO":
      return "Solo yo (gasto personal)";
    case "EQUAL":
      return "A partes iguales";
    case "PROPORTIONAL":
      return "Proporcional al ingreso";
    default:
      return "Sin definir";
  }
}

// ---- Helpers ----------------------------------------------------------

function userIdOf(ctx: Context): bigint | null {
  return ctx.from ? BigInt(ctx.from.id) : null;
}

async function linkedMemberFor(ctx: Context): Promise<LinkedMember | null> {
  const id = userIdOf(ctx);
  if (id === null) return null;
  return resolveLinkedMember(id);
}

/**
 * The gate. An unlinked user gets one instruction and nothing else — no
 * household data, no confirmation that a household even exists.
 */
async function requireLinked(ctx: Context): Promise<LinkedMember | null> {
  const member = await linkedMemberFor(ctx);
  if (member) return member;
  await ctx.reply(
    "No reconozco esta cuenta. Genera un código en la app y envíamelo así:\n`/link ABCD2345`",
    { parse_mode: "Markdown" }
  );
  return null;
}

async function expiredCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery({ text: "Este gasto ha caducado." });
  await ctx.reply("Ese gasto ha caducado por inactividad. Empieza otro con /gasto.");
}

/** Escapes the characters that would otherwise break Markdown parsing in a user-supplied title. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[\]])/g, "\\$1");
}
