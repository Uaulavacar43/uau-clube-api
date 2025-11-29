-- CreateEnum
CREATE TYPE "public"."WalletType" AS ENUM ('INTERNAL', 'ALLOYAL');

-- CreateEnum
CREATE TYPE "public"."BonusType" AS ENUM ('UNIQUE', 'RECURRENT');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('EARNED', 'USED');

-- CreateEnum
CREATE TYPE "public"."TransactionSource" AS ENUM ('INDICATION', 'PARTNER_LOCAL', 'ALLOYAL', 'SUBSCRIPTION_DEBIT', 'QR_REDEMPTION');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."SubscriptionStatus_new" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELED');
ALTER TABLE "public"."Subscription" ALTER COLUMN "subscriptionStatus" TYPE "public"."SubscriptionStatus_new" USING ("subscriptionStatus"::text::"public"."SubscriptionStatus_new");
ALTER TYPE "public"."SubscriptionStatus" RENAME TO "SubscriptionStatus_old";
ALTER TYPE "public"."SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
DROP TYPE "public"."SubscriptionStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "cashbackUsedAmount" DECIMAL(10,2) DEFAULT 0.00,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."Plan" ADD COLUMN     "maxInstallments" INTEGER DEFAULT 0,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."Subscription" ADD COLUMN     "subscriptionStatus" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "referrerId" INTEGER;

-- CreateTable
CREATE TABLE "public"."CashbackWallet" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "public"."WalletType" NOT NULL DEFAULT 'INTERNAL',
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashbackWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CashbackTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "public"."TransactionType" NOT NULL,
    "source" "public"."TransactionSource" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashbackTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReferralBonus" (
    "id" SERIAL NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "payerId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "type" "public"."BonusType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashbackWallet_userId_type_key" ON "public"."CashbackWallet"("userId", "type");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CashbackWallet" ADD CONSTRAINT "CashbackWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CashbackTransaction" ADD CONSTRAINT "CashbackTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralBonus" ADD CONSTRAINT "ReferralBonus_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

