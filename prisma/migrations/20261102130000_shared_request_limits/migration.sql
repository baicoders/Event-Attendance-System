-- CreateTable
CREATE TABLE "RequestRateLimit" (
    "key" VARCHAR(64) NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RequestRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RequestRateLimit_resetAt_idx" ON "RequestRateLimit"("resetAt");

