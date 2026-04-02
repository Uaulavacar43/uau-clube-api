import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";

const BONUS_MAX = 21; // R$21 no dia do cadastro
const BONUS_DAILY_REDUCTION = 3; // R$3 a menos por dia
const BONUS_EXPIRY_DAYS = 7; // zera às 00:00h do dia 8 (7 dias após cadastro)

export class WelcomeBonusService {
	constructor(private userRepository: IUserRepository) {}

	/**
	 * Calcula o bônus de boas-vindas atual do usuário com base na data de cadastro.
	 * Dia 1 = R$21, diminui R$3 por dia. Zera às 00:00h do dia 8.
	 */
	calculateBonus(userCreatedAt: Date, welcomeBonusUsed: boolean): number {
		if (welcomeBonusUsed) return 0;

		const now = new Date();
		const msPerDay = 24 * 60 * 60 * 1000;
		const daysElapsed = Math.floor(
			(now.getTime() - userCreatedAt.getTime()) / msPerDay,
		);

		if (daysElapsed >= BONUS_EXPIRY_DAYS) return 0;

		return Math.max(0, BONUS_MAX - daysElapsed * BONUS_DAILY_REDUCTION);
	}

	async getBonusForUser(userId: number) {
		const user = await this.userRepository.findById(userId);
		if (!user) return null;

		const bonusAmount = this.calculateBonus(
			user.createdAt,
			user.welcomeBonusUsed ?? false,
		);

		const msPerDay = 24 * 60 * 60 * 1000;
		const daysElapsed = Math.floor(
			(new Date().getTime() - new Date(user.createdAt).getTime()) / msPerDay,
		);
		const daysRemaining = Math.max(0, BONUS_EXPIRY_DAYS - daysElapsed);

		// Calcula a data de expiração (00:00h do dia 8)
		const expiresAt = new Date(user.createdAt);
		expiresAt.setDate(expiresAt.getDate() + BONUS_EXPIRY_DAYS);
		expiresAt.setHours(0, 0, 0, 0);

		return {
			bonusAmount,
			daysElapsed,
			daysRemaining,
			expiresAt: expiresAt.toISOString(),
			isExpired: bonusAmount === 0,
			isUsed: user.welcomeBonusUsed ?? false,
		};
	}
}
