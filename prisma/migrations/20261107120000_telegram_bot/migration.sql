-- Telegram bot: account linking, conversation state, and /link throttling.
--
-- Taken from `migrate diff` unmodified, unlike the budget and recurrence
-- migrations: this one is purely additive (four new tables, no column
-- drops or renames), so the generated ordering cannot lose data.
--
-- Deliberately no RLS. Every existing table in this schema has RLS
-- disabled and there are zero policies, and the app connects as the
-- `postgres` superuser, which bypasses RLS anyway. Policies here would
-- enforce nothing while implying otherwise. See AUTH_TODO.md.

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "code" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramSession" (
    "chatId" BIGINT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "step" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSession_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "TelegramLinkAttempt" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramLinkCode_memberId_idx" ON "TelegramLinkCode"("memberId");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_expiresAt_idx" ON "TelegramLinkCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_telegramUserId_key" ON "TelegramLink"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_memberId_key" ON "TelegramLink"("memberId");

-- CreateIndex
CREATE INDEX "TelegramSession_updatedAt_idx" ON "TelegramSession"("updatedAt");

-- CreateIndex
CREATE INDEX "TelegramLinkAttempt_telegramUserId_createdAt_idx" ON "TelegramLinkAttempt"("telegramUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
