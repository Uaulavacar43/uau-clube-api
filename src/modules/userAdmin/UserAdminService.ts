import { User } from "../../entities/User";
import { AppError } from "../../error/AppError";
import type { IIndividualServicePurchaseRepository } from "../../repositories/interfaces/IIndividualServicePurchaseRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import { hashPassword } from "../../utils/password";
import type { GetAllUsersDTO } from "./dto/GetAllUsersDTO";
import type { RegisterUserDTO } from "./dto/RegisterUserDTO";
import type { UpdateUserDTO } from "./dto/UpdateUserDTO";

export class UserService {
	constructor(
		private userRepository: IUserRepository,
		private subscriptionRepository: ISubscriptionRepository,
		private individualServicePurchaseRepository: IIndividualServicePurchaseRepository,
	) {}

	public async createUser(data: RegisterUserDTO): Promise<User> {
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

		// Verificar que a senha não seja `undefined` antes de aplicar o hash (somente para USER)
		let hashedPassword = "";
		if (!data.password) {
			throw new AppError("Senha é obrigatória", 400);
		}
		hashedPassword = await hashPassword(data.password);

		// Criar o usuário
		const user = new User({
			id: 0, // `id` será gerado pelo banco de dados
			name: data.name,
			email: data.email,
			password: hashedPassword,
			phone: data.phone || null,
			cpf: data.cpf || null,
			role: data.role || "USER",
		});

		return await this.userRepository.create(user);
	}

	// Atualizar um usuário existente
	public async updateUser(data: UpdateUserDTO): Promise<User> {
		const existingUser = await this.userRepository.findById(data.id);
		if (!existingUser) {
			throw new AppError("Usuário não encontrado", 404);
		}

		// Atualizar os campos de acordo com os dados fornecidos
		existingUser.name = data.name ?? existingUser.name;
		existingUser.email = data.email ?? existingUser.email;
		existingUser.phone = data.phone ?? existingUser.phone;
		existingUser.role = data.role ?? existingUser.role;
		existingUser.status = data.status ?? existingUser.status;

		// Atualizar a senha somente se uma nova for fornecida
		if (data.password) {
			existingUser.password = await hashPassword(data.password);
		}

		return await this.userRepository.update(data.id, existingUser);
	}

	// Excluir um usuário pelo ID
	public async deleteUser(userId: number): Promise<void> {
		const existingUser = await this.userRepository.findById(userId);
		if (!existingUser) {
			throw new AppError("Usuário não encontrado", 404);
		}

		const existingSubscriptions =
			await this.subscriptionRepository.findByUserId(userId);
		if (existingSubscriptions.length > 0) {
			throw new AppError(
				"Não é possível cancelar a conta com assinaturas ativas",
				400,
			);
		}

		await this.userRepository.delete(userId);
	}

	public async updateIndividualServicePurchase(
		id: number,
		status: "PENDING" | "COMPLETED" | "CANCELED",
	): Promise<void> {
		const existingIndividualServicePurchase =
			await this.individualServicePurchaseRepository.findById(id);
		if (!existingIndividualServicePurchase) {
			throw new AppError("Esta compra não foi encontrada", 404);
		}

		await this.individualServicePurchaseRepository.updateStatus(id, status);
	}

	// Obter um usuário pela placa do veículo
	public async getUserByLicensePlate(licensePlate: string): Promise<User> {
		const user = await this.userRepository.findByLicensePlate(licensePlate);
		if (!user) {
			throw new AppError("Usuário não encontrado", 404);
		}

		return user;
	}

	// Obter um usuário pelo ID
	public async getUserById(userId: number): Promise<User> {
		const user = await this.userRepository.findById(userId);
		if (!user) {
			throw new AppError("Usuário não encontrado", 404);
		}

		return user;
	}

	// Obter todos os usuários
	public async getAllUsers(
		filters: GetAllUsersDTO,
	): Promise<{ users: User[]; total: number }> {
		const { users, total } =
			await this.userRepository.findAllWithPagination(filters);
		return { users, total };
	}

	public async getUsersByRole(
		role: "ADMIN" | "USER" | "MANAGER",
		page: number,
		pageSize: number,
	): Promise<{ users: User[]; total: number }> {
		const skip = (page - 1) * pageSize;
		return await this.userRepository.findAllByRole(role, skip, pageSize);
	}

	public async getUsersAndSubscribersCount(): Promise<{
		totalUsers: number;
		activeSubscribers: number;
	}> {
		const totalUsers = await this.userRepository.countAllUsers();
		const activeSubscribers =
			await this.userRepository.countActiveSubscribers();
		return { totalUsers, activeSubscribers };
	}

	// Método para contar todos os usuários
	public async countAllUsers(): Promise<number> {
		const users = await this.userRepository.findAll();
		return users.length;
	}

	// Método para contar os usuários com assinatura ativa
	public async countActiveSubscribers(): Promise<number> {
		return await this.userRepository.countActiveSubscribers();
	}
}
