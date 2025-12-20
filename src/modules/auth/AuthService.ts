import crypto from "crypto";
import prisma from "../../config/dbConfig";
import { User } from "../../entities/User";
import { AppError } from "../../error/AppError";
import type {
	IUserRepository,
	ReferralRequestContext,
} from "../../repositories/interfaces/IUserRepository";
import type { Mailer } from "../../third-party/Mailer";
import { isValidCpf } from "../../utils/cpf";
import { comparePassword, hashPassword } from "../../utils/password";
import { signToken, verifyToken } from "../../utils/token";
import type { LoginUserDTO } from "./dto/LoginUserDTO";
import type { RegisterUserDTO } from "./dto/RegisterUserDTO";
import type { ReferralsService } from "../referrals/referrals.service";
import {
	WalletType,
	TransactionType,
	TransactionSource,
} from "@prisma/client";

export class AuthService {
	constructor(
		private readonly userRepository: IUserRepository,
		private readonly referralsService: ReferralsService,
		private readonly mailer: Mailer,
	) {}

	private readonly accessTokenExpiry = "8h";
	private readonly refreshTokenExpiry = "3d";

	private static readonly WELCOME_BONUS_AMOUNT = 20;

	/**
	 * 🎁 WELCOME BONUS = CASHBACK (20 REAIS)
	 * Idempotente via eventKey
	 */
	private async grantWelcomeCashback(userId: number): Promise<void> {
		const eventKey = `WELCOME:${userId}`;

		const existingTx = await prisma.cashbackTransaction.findUnique({
			where: { eventKey },
			select: { id: true },
		});

		if (existingTx) {
			return;
		}

		// Garante carteira
		await prisma.cashbackWallet.upsert({
			where: {
				userId_type: {
					userId,
					type: WalletType.INTERNAL,
				},
			},
			create: {
				userId,
				type: WalletType.INTERNAL,
				balance: 0,
			},
			update: {},
		});

		await prisma.cashbackTransaction.create({
			data: {
				userId,
				type: TransactionType.EARNED,
				source: TransactionSource.WELCOME_BONUS,
				amount: AuthService.WELCOME_BONUS_AMOUNT,
				eventKey,
				meta: {
					reason: "WELCOME_BONUS",
					description: "Crédito de boas-vindas no cadastro",
				},
			},
		});

		await prisma.cashbackWallet.update({
			where: {
				userId_type: {
					userId,
					type: WalletType.INTERNAL,
				},
			},
			data: {
				balance: { increment: AuthService.WELCOME_BONUS_AMOUNT },
			},
		});
	}

	/**
	 * REGISTER — FLUXO OFICIAL
	 */
	public async register(
		data: RegisterUserDTO,
	): Promise<{
		token: string;
		refreshToken: string;
		user: User;
		referralLink: string;
	}> {
		if (!isValidCpf(data.cpf)) {
			throw new AppError("CPF inválido", 400);
		}

		if (await this.userRepository.findByCpf(data.cpf, true)) {
			throw new AppError("CPF já registrado", 400);
		}

		if (await this.userRepository.findByEmail(data.email, true)) {
			throw new AppError("E-mail já registrado", 400);
		}

		const hashedPassword = await hashPassword(data.password);

		/**
		 * 🔑 referralCode imutável
		 */
		const referralCode = crypto
			.randomUUID()
			.replace(/-/g, "")
			.slice(0, 8);

		/**
		 * 1️⃣ CRIA USUÁRIO
		 */
		const user = await this.userRepository.create(
			new User({
				id: 0,
				name: data.name,
				email: data.email,
				password: hashedPassword,
				phone: data.phone,
				cpf: data.cpf,
				role: "USER",
				referralCode,
				firebaseTokens: [],
			}),
		);

		/**
		 * 🎁 2️⃣ WELCOME BONUS
		 */
		await this.grantWelcomeCashback(user.id);

		/**
		 * 3️⃣ PROCESSA REFERRAL (SE VEIO)
		 */
		const referrerCode = (data as any).referrerCode as string | undefined;

		if (referrerCode && referrerCode.trim()) {
			const context: ReferralRequestContext = {
				source: "LINK",
				deviceId: (data as any).deviceId ?? null,
				ip: (data as any).ip ?? null,
				userAgent: (data as any).userAgent ?? null,
				meta: (data as any).referralMeta ?? undefined,
			};

			const strictReferral =
				(process.env.REFERRALS_STRICT_ON_REGISTER ?? "true")
					.toLowerCase() === "true";

			try {
				const attachResult =
					await this.userRepository.attachReferralOnSignup({
						referredId: user.id,
						referralCode: referrerCode,
						context,
					});

				if (!attachResult.attached && strictReferral) {
					throw new AppError("Código de indicação inválido", 400);
				}

				await this.referralsService.onUserJoinedByReferral({
					newUserId: user.id,
				});
			} catch (error) {
				if (strictReferral) {
					throw error instanceof AppError
						? error
						: new AppError("Erro ao processar indicação", 500);
				}
			}
		}

		/**
		 * 4️⃣ TOKENS
		 */
		const token = signToken(
			{ id: user.id, role: user.role },
			this.accessTokenExpiry,
		);

		const refreshToken = signToken(
			{ id: user.id, role: user.role },
			this.refreshTokenExpiry,
		);

		/**
		 * 🔗 LINK DE INDICAÇÃO
		 */
		const referralLink = `${process.env.APP_BASE_URL}/cadastro?ref=${referralCode}`;

		return { token, refreshToken, user, referralLink };
	}

	/**
	 * LOGIN
	 */
	public async login(
		data: LoginUserDTO,
	): Promise<{ token: string; refreshToken: string; user: User }> {
		const user = await this.userRepository.findByEmail(data.email);
		if (!user || !user.password) {
			throw new AppError("Credenciais inválidas", 401);
		}

		if (!(await comparePassword(data.password, user.password))) {
			throw new AppError("Credenciais inválidas", 401);
		}

		const token = signToken(
			{ id: user.id, role: user.role },
			this.accessTokenExpiry,
		);

		const refreshToken = signToken(
			{ id: user.id, role: user.role },
			this.refreshTokenExpiry,
		);

		return { token, refreshToken, user };
	}

	public async refreshToken(
		refreshToken: string,
	): Promise<{ token: string; refreshToken: string }> {
		const payload = verifyToken(refreshToken);

		const token = signToken(
			{ id: payload.id, role: payload.role },
			this.accessTokenExpiry,
		);

		const newRefreshToken = signToken(
			{ id: payload.id, role: payload.role },
			this.refreshTokenExpiry,
		);

		return { token, refreshToken: newRefreshToken };
	}
	public async getReferralLink(
		userId: number,
	): Promise<{ referralCode: string; referralLink: string }> {
		const user = await this.userRepository.findById(userId);

		if (!user || !user.referralCode) {
			throw new AppError("Usuário ou código de indicação não encontrado", 404);
		}

		const referralLink = `${process.env.APP_BASE_URL}/cadastro?ref=${user.referralCode}`;

		return {
			referralCode: user.referralCode,
			referralLink,
		};
	}

}
