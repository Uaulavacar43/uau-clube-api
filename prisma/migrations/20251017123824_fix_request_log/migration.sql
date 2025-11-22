/*
  Warnings:

  - A unique constraint covering the columns `[requestId]` on the table `RequestLog` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "logs"."RequestLog" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RequestLog_requestId_key" ON "logs"."RequestLog"("requestId");
