import { AppError } from "../../error/AppError";
import type { User } from "../../entities/User";
import type {
    CreateUserReferralInput,
    IUserRepository,
    ReferralSource,
} from "../../repositories/interfaces/IUserRepository";
import prisma from "../../config/dbConfig";
import {
    Prisma,
    BonusType,
    TransactionType,
    TransactionSource,
    WalletType,
} from "@prisma/client";

export interface AttachReferralOnSignupInput {
    userId: number;

    referralCode?: string;
    referrerId?: number;

    source?: ReferralSource;

    deviceId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    meta?: unknown;
}

export interface ValidateReferralResult {
    isValid: boolean;
    referrer: { id: number; name: string } | null;
}

export class ReferralsService {
    private static readonly DEFAULT_MAX_MEMBERS = 9;

    constructor(private readonly userRepository: IUserRepository) {}

    // ---------------------------------------------------------------------
    // NORMALIZA JSON PARA PRISMA
    // ---------------------------------------------------------------------
    private normalizePrismaJsonMeta(
        meta: unknown,
    ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
        if (meta === null || meta === undefined) {
            return undefined;
        }

        return meta as Prisma.InputJsonValue;
    }

    // ---------------------------------------------------------------------
    // RESOLVE REFERRER POR CÓDIGO
    // ---------------------------------------------------------------------
    public async resolveReferrer(referralCode: string): Promise<User | null> {
        const code = (referralCode ?? "").trim();
        if (!code) return null;

        const referrer = await this.userRepository.findByReferralCode(code, false);
        if (!referrer) return null;

        if ((referrer as any).status && (referrer as any).status !== "ACTIVE") {
            return null;
        }

        return referrer;
    }

    // ---------------------------------------------------------------------
    // VALIDAR REFERRAL (ENDPOINT)
    // ---------------------------------------------------------------------
    public async validateReferral(
        referralCode: string,
    ): Promise<ValidateReferralResult> {
        const referrer = await this.resolveReferrer(referralCode);

        return {
            isValid: Boolean(referrer),
            referrer: referrer
                ? { id: (referrer as any).id, name: (referrer as any).name }
                : null,
        };
    }

    // ---------------------------------------------------------------------
    // 🔥 EVENTO ECONÔMICO: USUÁRIO ENTROU POR REFERRAL
    // ---------------------------------------------------------------------
    /**
     * Disparado UMA ÚNICA VEZ no cadastro.
     * Responsável por:
     * - identificar grupo
     * - identificar posição do novo usuário
     * - pagar bônus UNIQUE para TODOS do grupo até essa posição
     * - creditar cashback corretamente
     */
    public async onUserJoinedByReferral(params: {
        newUserId: number;
    }): Promise<void> {
        const { newUserId } = params;

        const membership = await prisma.referralGroupMember.findFirst({
            where: { userId: newUserId },
            include: { group: true },
        });

        if (!membership) {
            throw new AppError(
                "Usuário não pertence a nenhum grupo de indicação.",
                500,
            );
        }

        const { groupId, position } = membership;

        const bonusConfigs =
            await prisma.referralPositionBonusConfig.findMany({
                where: {
                    isActive: true,
                    type: BonusType.UNIQUE,
                    position: { lte: position },
                },
                orderBy: { position: "asc" },
            });

        for (const config of bonusConfigs) {
            const receiverMembership =
                await prisma.referralGroupMember.findFirst({
                    where: {
                        groupId,
                        position: config.position,
                    },
                });

            if (!receiverMembership) continue;

            const eventKey = `JOIN:GROUP:${groupId}:POS:${config.position}:NEW_USER:${newUserId}`;

            try {
                const bonus = await prisma.referralBonus.create({
                    data: {
                        receiverId: receiverMembership.userId,
                        payerId: newUserId,
                        level: config.position,
                        type: BonusType.UNIQUE,
                        amount: config.amount,
                        paymentStatus: "PAID",
                        eventKey,
                    },
                });

                await prisma.cashbackWallet.upsert({
                    where: {
                        userId_type: {
                            userId: receiverMembership.userId,
                            type: WalletType.INTERNAL,
                        },
                    },
                    create: {
                        userId: receiverMembership.userId,
                        type: WalletType.INTERNAL,
                        balance: 0,
                    },
                    update: {},
                });

                await prisma.cashbackTransaction.create({
                    data: {
                        userId: receiverMembership.userId,
                        type: TransactionType.EARNED,
                        source: TransactionSource.INDICATION,
                        amount: config.amount,
                        relatedId: String(bonus.id),
                        eventKey,
                        referralGroupId: groupId,
                        referralPosition: config.position,
                        meta: {
                            reason: "USER_JOINED_GROUP",
                            newUserId,
                        },
                    },
                });

                await prisma.cashbackWallet.update({
                    where: {
                        userId_type: {
                            userId: receiverMembership.userId,
                            type: WalletType.INTERNAL,
                        },
                    },
                    data: {
                        balance: { increment: config.amount },
                    },
                });
            } catch (error: any) {
                if (error?.code === "P2002") {
                    continue;
                }
                throw error;
            }
        }
    }

    // ---------------------------------------------------------------------
    // GRUPO FECHADO (9 PESSOAS) — CRIAÇÃO E ALOCAÇÃO
    // ---------------------------------------------------------------------
    private async getOrCreateOpenLeaderGroupTx(
        tx: Prisma.TransactionClient,
        leaderUserId: number,
    ): Promise<{ groupId: number; maxMembers: number }> {
        const existing = await tx.referralGroupMember.findFirst({
            where: {
                userId: leaderUserId,
                position: 1,
                group: { isClosed: false },
            },
            select: {
                groupId: true,
                group: { select: { maxMembers: true } },
            },
        });

        if (existing && existing.group) {
            return {
                groupId: existing.groupId,
                maxMembers: existing.group.maxMembers,
            };
        }

        const group = await tx.referralGroup.create({
            data: {
                maxMembers: ReferralsService.DEFAULT_MAX_MEMBERS,
                isClosed: false,
                cashbackSuspended: false,
            },
        });

        await tx.referralGroupMember.create({
            data: {
                groupId: group.id,
                userId: leaderUserId,
                position: 1,
            },
        });

        return { groupId: group.id, maxMembers: group.maxMembers };
    }

    private findNextFreePosition(
        positions: number[],
        maxMembers: number,
    ): number | null {
        const used = new Set(positions);

        for (let pos = 2; pos <= maxMembers; pos++) {
            if (!used.has(pos)) return pos;
        }

        return null;
    }

    private async addMemberToLeaderGroupTx(
        tx: Prisma.TransactionClient,
        leaderUserId: number,
        newUserId: number,
    ): Promise<void> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const { groupId, maxMembers } =
                await this.getOrCreateOpenLeaderGroupTx(tx, leaderUserId);

            const members = await tx.referralGroupMember.findMany({
                where: { groupId },
                select: { position: true },
            });

            const nextPosition = this.findNextFreePosition(
                members.map((m) => m.position),
                maxMembers,
            );

            if (!nextPosition) {
                await tx.referralGroup.update({
                    where: { id: groupId },
                    data: { isClosed: true, closedAt: new Date() },
                });
                continue;
            }

            try {
                await tx.referralGroupMember.create({
                    data: {
                        groupId,
                        userId: newUserId,
                        position: nextPosition,
                    },
                });

                const count = await tx.referralGroupMember.count({
                    where: { groupId },
                });

                if (count >= maxMembers) {
                    await tx.referralGroup.update({
                        where: { id: groupId },
                        data: { isClosed: true, closedAt: new Date() },
                    });
                }

                return;
            } catch (error: any) {
                if (error?.code === "P2002") {
                    continue;
                }
                throw error;
            }
        }

        throw new AppError(
            "Não foi possível inserir usuário no grupo de indicação.",
            409,
        );
    }

    // ---------------------------------------------------------------------
    // ATTACH REFERRAL NO CADASTRO
    // ---------------------------------------------------------------------
    public async attachReferralOnSignup(
        input: AttachReferralOnSignupInput,
    ): Promise<void> {
        const userId = Number(input.userId);

        if (!userId || Number.isNaN(userId)) {
            throw new AppError("userId inválido.", 400);
        }

        const user = await this.userRepository.findById(userId, true);
        if (!user) {
            throw new AppError("Usuário não encontrado.", 404);
        }

        const hasReferral =
            Boolean(input.referrerId) ||
            Boolean((input.referralCode ?? "").trim());

        if (!hasReferral) return;

        if ((user as any).referrerId) {
            throw new AppError("Usuário já possui referenciador.", 409);
        }

        const hasAudit = await this.userRepository.hasReferralReceived(userId);
        if (hasAudit) {
            throw new AppError("Usuário já possui indicação registrada.", 409);
        }

        let referrer: User | null = null;

        if (input.referrerId) {
            referrer = await this.userRepository.findById(
                input.referrerId,
                false,
            );
        }

        if (!referrer) {
            referrer = await this.resolveReferrer(
                input.referralCode ?? "",
            );
        }

        if (!referrer) {
            throw new AppError("Referenciador inválido.", 404);
        }

        if ((referrer as any).id === userId) {
            throw new AppError("Auto-indicação não permitida.", 400);
        }

        const referrerId = Number((referrer as any).id);

        await prisma.$transaction(async (tx) => {
            await this.userRepository.updateReferrerId(userId, referrerId);

            const audit: CreateUserReferralInput = {
                referrerId,
                referredId: userId,
                source: input.source ?? "UNKNOWN",
                deviceId: input.deviceId ?? null,
                ip: input.ip ?? null,
                userAgent: input.userAgent ?? null,
                meta: this.normalizePrismaJsonMeta(input.meta) as any,
            };

            await this.userRepository.createUserReferral(audit);

            await this.addMemberToLeaderGroupTx(tx, referrerId, userId);
        });

        // 🔥 DISPARA EVENTO ECONÔMICO
        await this.onUserJoinedByReferral({ newUserId: userId });
    }
}
