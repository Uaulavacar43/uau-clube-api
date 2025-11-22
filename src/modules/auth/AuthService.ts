import { User } from "../../entities/User";
import { AppError } from "../../error/AppError";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
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

		// Verificar se já existe um usuário com o e-mail fornecido
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
		// Adiciona o token à lista
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
		// Remove o token da lista
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
