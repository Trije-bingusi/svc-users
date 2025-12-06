-- CreateTable
CREATE TABLE "UserProfile" (
    "id" UUID NOT NULL,
    "oidc_sub" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "role" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_oidc_sub_key" ON "UserProfile"("oidc_sub");
