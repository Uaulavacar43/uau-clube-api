import { AppError } from "../../error/AppError";
import type { User } from "../../entities/User";
import type {
    CreateUserReferralInput,
    IUserRepository,
    ReferralSource,
} from "../../repositories/interfaces/IUserRepository";

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
    constructor(private readonly userRepository: IUserRepository) {}

    /**
     * Resolve o referrer (quem indicou) via referralCode.
     * Retorna null se não existir / inativo / vazio.
     */
    public async resolveReferrer(referralCode: string): Promise<User | null> {
        const code = (referralCode ?? "").trim();
        if (!code) return null;

        // withIsDeleted=false para não aceitar deletados
        const referrer = await this.userRepository.findByReferralCode(code, false);
        if (!referrer) return null;

        if ((referrer as any).status && (referrer as any).status !== "ACTIVE") {
            return null;
        }

        return referrer;
    }

    /**
     * Mesmo payload do endpoint /referrals/validate
     */
    public async validateReferral(referralCode: string): Promise<ValidateReferralResult> {
        const referrer = await this.resolveReferrer(referralCode);

        return {
            isValid: Boolean(referrer),
            referrer: referrer ? { id: (referrer as any).id, name: (referrer as any).name } : null,
        };
    }

    /**
     * FASE 1:
     * - valida inputs
     * - resolve referrer por id ou code
     * - bloqueia auto-indicação
     * - bloqueia troca (se já tem referrerId ou já tem auditoria)
     * - grava vínculo (User.referrerId)
     * - grava auditoria (UserReferral)
     *
     * Importante: NÃO gera bônus aqui.
     */
    public async attachReferralOnSignup(input: AttachReferralOnSignupInput): Promise<void> {
        const userId = Number(input.userId);

        if (!userId || Number.isNaN(userId)) {
            throw new AppError("userId inválido.", 400);
        }

        const source: ReferralSource = input.source ?? "UNKNOWN";

        // withIsDeleted=true para suportar cenários onde você quer bloquear mesmo se deletado (dependendo da regra)
        const user = await this.userRepository.findById(userId, true);
        if (!user) {
            throw new AppError("Usuário não encontrado.", 404);
        }

        const hasAnyReferralInfo =
            (Boolean(input.referrerId) && Number(input.referrerId) > 0) ||
            Boolean((input.referralCode ?? "").trim());

        if (!hasAnyReferralInfo) {
            // Sem indicação: não faz nada
            return;
        }

        // Bloqueia se já existe vínculo rápido
        if ((user as any).referrerId && (user as any).referrerId > 0) {
            throw new AppError("Usuário já possui referenciador associado.", 409);
        }

        // Bloqueia se já existe auditoria formal de indicação recebida
        const alreadyHasFormalReferral = await this.userRepository.hasReferralReceived(userId);
        if (alreadyHasFormalReferral) {
            throw new AppError("Usuário já possui indicação registrada.", 409);
        }

        let referrer: User | null = null;

        // 1) Se veio referrerId, resolve por ID
        if (input.referrerId && input.referrerId > 0) {
            referrer = await this.userRepository.findById(input.referrerId, false);

            if (!referrer) {
                throw new AppError("Referenciador não encontrado.", 404);
            }

            if ((referrer as any).status && (referrer as any).status !== "ACTIVE") {
                throw new AppError("Referenciador inativo.", 400);
            }
        }

        // 2) Se não veio referrerId (ou não achou), resolve por referralCode
        if (!referrer) {
            const code = (input.referralCode ?? "").trim();
            referrer = await this.resolveReferrer(code);

            if (!referrer) {
                throw new AppError("Código de indicação inválido.", 404);
            }
        }

        // Auto-referral
        if ((referrer as any).id === userId) {
            throw new AppError("Auto-indicação não é permitida.", 400);
        }

        // Grava vínculo rápido (nível 1)
        await this.userRepository.updateReferrerId(userId, (referrer as any).id);

        // Grava auditoria formal (UserReferral)
        const referralAudit: CreateUserReferralInput = {
            referrerId: (referrer as any).id,
            referredId: userId,
            source,
            deviceId: input.deviceId ?? null,
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
            meta: input.meta,
        };

        await this.userRepository.createUserReferral(referralAudit);
    }
}
