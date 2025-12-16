import { User } from "../../entities/User";
import { AppError } from "../../error/AppError";
import type { IUserRepository, ReferralRequestContext } from "../../repositories/interfaces/IUserRepository";
import type { Mailer } from "../../third-party/Mailer";
import { isValidCpf } from "../../utils/cpf";
import { comparePassword, hashPassword } from "../../utils/password";
import { signToken, verifyToken } from "../../utils/token";
import type { LoginUserDTO } from "./dto/LoginUserDTO";
import type { RegisterUserDTO } from "./dto/RegisterUserDTO";

export class AuthService {
	constructor(
		private userRepository: IUserRepository,
		private mailer: Mailer,
	) {}

	private readonly accessTokenExpiry = "8h";
	private readonly refreshTokenExpiry = "3d";

	/**
	 * Register (com suporte a referrals - Fase 1):
	 * - cria usuário
	 * - se vier referrerCode (ou referralCode alias no DTO), tenta anexar:
	 *   - preenche User.referrerId
	 *   - cria UserReferral (auditoria)
	 *
	 * Observação:
	 * - Para capturar deviceId/ip/userAgent, o ideal é o Controller passar esses dados.
	 * - Para não quebrar assinatura agora, mantive esses campos como opcionais via data as any.
	 */
	public async register(
		data: RegisterUserDTO,
	): Promise<{ token: string; refreshToken: string; user: User }> {
		if (!isValidCpf(data.cpf)) {
			throw new AppError("CPF inválido", 400);
		}

		if (data.cpf) {
			const existingUserByCpf = await this.userRepository.findByCpf(
				data.cpf,
				true,
			);
			if (existingUserByCpf) {
				if (existingUserByCpf.deletedAt) {
					throw new AppError(
						"Este CPF já está registrado na plataforma, se você está tentando reativar a conta, entre em contato com o suporte",
						400,
					);
				}

				throw new AppError("CPF já registrado", 400);
			}
		}

		const existingUserByEmail = await this.userRepository.findByEmail(
			data.email,
			true,
		);
		if (existingUserByEmail) {
			if (existingUserByEmail.deletedAt) {
				throw new AppError(
					"Este e-mail já está registrado na plataforma, se você está tentando reativar a conta, entre em contato com o suporte",
					400,
				);
			}

			throw new AppError("E-mail já registrado", 400);
		}

		const hashedPassword = await hashPassword(data.password);

		// 1) Cria o usuário normalmente
		const user = await this.userRepository.create(
			new User({
				id: 0,
				name: data.name,
				email: data.email,
				password: hashedPassword,
				phone: data.phone,
				cpf: data.cpf,
				role: "USER",
				firebaseTokens: [],
			}),
		);

		const referrerCode = (data as any).referrerCode as string | undefined;

		if (referrerCode && referrerCode.trim().length > 0) {
			const context: ReferralRequestContext = {
				source: "LINK",
				deviceId: (data as any).deviceId ?? null,
				ip: (data as any).ip ?? null,
				userAgent: (data as any).userAgent ?? null,
				meta: (data as any).referralMeta ?? undefined,
			};

			// Política robusta:
			// - strictReferral=true => se veio código, referral deve aplicar ou falhar o cadastro
			// - strictReferral=false => se falhar, loga e segue (soft-fail)
			const strictReferral =
				(process.env.REFERRALS_STRICT_ON_REGISTER ?? "true").toLowerCase() === "true";

			try {
				const attachResult = await this.userRepository.attachReferralOnSignup({
					referredId: user.id,
					referralCode: referrerCode,
					context,
				});

				if (attachResult.attached && attachResult.referrerId) {
					(user as any).referrerId = attachResult.referrerId;
				} else {
					// Se veio código e não anexou, isso é sinal de regra de negócio não atendida.
					// Em modo estrito: falha. Em modo soft: loga.
					const msg =
						"Não foi possível anexar referral no cadastro (attachReferralOnSignup retornou attached=false).";

					console.warn("[AuthService.register][referral] " + msg, {
						referredId: user.id,
						referrerCode: referrerCode,
						result: attachResult,
					});

					if (strictReferral) {
						throw new AppError("Código de indicação inválido", 400);
					}
				}
			} catch (error) {
				// Log SEM vazar dados sensíveis
				console.error("[AuthService.register][referral] Falha ao anexar referral", {
					referredId: user.id,
					referrerCode: referrerCode,
					errorName: error instanceof Error ? error.name : typeof error,
					errorMessage: error instanceof Error ? error.message : String(error),
				});

				// Se você quer robustez e consistência, o ideal é: se veio código, não aceitar cadastro
				// se falhou a aplicação do referral (exceto se você deliberadamente aceitar soft-fail).
				if (strictReferral) {
					if (error instanceof AppError) {
						// Propaga erro de regra de negócio (400/404/etc.)
						throw error;
					}
					throw new AppError("Erro ao processar código de indicação", 500);
				}

				// Soft-fail: segue cadastro sem referral
			}
		}

		// 3) Emite tokens
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

	public async login(
		data: LoginUserDTO,
	): Promise<{ token: string; refreshToken: string; user: User }> {
		const user = await this.userRepository.findByEmail(data.email);
		if (!user || !user.password) {
			throw new AppError("Credenciais inválidas", 401);
		}

		const isPasswordValid = await comparePassword(data.password, user.password);
		if (!isPasswordValid) {
			throw new AppError("Credenciais inválidas", 401);
		}

		if (user.status !== "ACTIVE") {
			throw new AppError("Conta inativa. Entre em contato com o suporte.", 403);
		}

		const token = signToken(
			{ id: user.id, role: user.role },
			this.accessTokenExpiry,
		);
		const refreshToken = signToken(
			{ id: user.id, role: user.role },
			this.refreshTokenExpiry,
		);

		if (data.firebaseToken) {
			await this.userRepository.addFirebaseToken(user.id, data.firebaseToken);
		}

		return { token, refreshToken, user };
	}

	public async updateFirebaseToken(
		userId: number,
		firebaseToken: string,
	): Promise<void> {
		await this.userRepository.addFirebaseToken(userId, firebaseToken);
	}

	public async getFirebaseTokens(userId: number): Promise<string[]> {
		const tokens = await this.userRepository.getFirebaseTokensById(userId);
		if (!tokens || tokens.length === 0) {
			throw new AppError(
				"Nenhum token do Firebase encontrado para este usuário",
				404,
			);
		}
		return tokens;
	}

	public async removeFirebaseToken(
		userId: number,
		firebaseToken: string,
	): Promise<void> {
		await this.userRepository.removeFirebaseToken(userId, firebaseToken);
	}

	public async refreshToken(
		refreshToken: string,
	): Promise<{ token: string; refreshToken: string }> {
		try {
			const payload = verifyToken(refreshToken);
			const userId = payload.id;

			const user = await this.userRepository.findById(userId);
			if (!user) {
				throw new AppError("Usuário não encontrado", 404);
			}

			const token = signToken(
				{ id: user.id, role: user.role },
				this.accessTokenExpiry,
			);
			const newRefreshToken = signToken(
				{ id: user.id, role: user.role },
				this.refreshTokenExpiry,
			);

			return { token, refreshToken: newRefreshToken };
		} catch (_error) {
			throw new AppError("Refresh token inválido ou expirado", 401);
		}
	}
}
