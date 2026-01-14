import { forgotPasswordEmail } from "../../emails/forgotPassword";
import type { User } from "../../entities/User";
import { AppError } from "../../error/AppError";
import type { MailingQueue } from "../../queues/MailingQueue";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import { comparePassword, hashPassword } from "../../utils/password";
import type { UpdateUserPasswordDTO } from "./dto/UpdateUserPasswordDTO";
import type { UpdateUserProfileDTO } from "./dto/UpdateUserProfileDTO";

export class UserProfileService {
	constructor(
		private userRepository: IUserRepository,
		private mailingQueue: MailingQueue,
	) {}

	public async updateUserProfile(
		userId: number,
		data: UpdateUserProfileDTO,
	): Promise<User> {
		const existingUser = await this.userRepository.findById(userId);
		if (!existingUser) {
			throw new AppError("Usuário não encontrado", 404);
		}

		existingUser.name = data.name ?? existingUser.name;
		existingUser.email = data.email ?? existingUser.email;
		existingUser.phone = data.phone ?? existingUser.phone;
		existingUser.cpf = data.cpf ?? existingUser.cpf;

		if (data.profileImageUrl) {
			existingUser.profileImageUrl = data.profileImageUrl;
		}

		return await this.userRepository.update(userId, existingUser);
	}

	public async updatePassword(
		userId: number,
		data: UpdateUserPasswordDTO,
	): Promise<User> {
		const existingUser = await this.userRepository.findById(userId);
		if (!existingUser) {
			throw new AppError("Usuário não encontrado", 404);
		}

		const isPasswordValid = await comparePassword(
			data.currentPassword,
			existingUser.password,
		);
		if (!isPasswordValid) {
			throw new AppError("Senha atual inválida", 400);
		}

		existingUser.password = await hashPassword(data.password);

		return await this.userRepository.update(userId, existingUser);
	}

	public async requestPasswordReset(email: string): Promise<void> {
		const user = await this.userRepository.findByEmail(email);
		if (!user) {
			throw new AppError("Usuário não encontrado", 404);
		}

		const otp = Math.random().toString(36).substring(2, 8).toUpperCase(); // Gera um token único
		await this.userRepository.update(user.id, { otp });

		const { html, text, subject } = forgotPasswordEmail(otp);
		await this.mailingQueue.addToQueue({ to: email, subject, text, html });
	}

	public async resetPassword(
		email: string,
		token: string,
		newPassword: string,
	): Promise<void> {
		const user = await this.userRepository.findByEmail(email);
		if (!user || user.otp !== token) {
			throw new AppError("Token inválido ou usuário não encontrado", 401);
		}

		const hashedPassword = await hashPassword(newPassword);
		await this.userRepository.update(user.id, {
			password: hashedPassword,
			otp: null,
		});
	}
}
