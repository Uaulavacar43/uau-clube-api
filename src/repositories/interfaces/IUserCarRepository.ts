import type { UserCar } from "../../entities/UserCar";
import type { UpdateUserCarDTO } from "../../modules/userCar/dto/UpdateUserCarDTO";

/**
 * DTO interno do repositório (não é DTO de request).
 * - Não precisa de "id" no payload porque o id já vai no 1º parâmetro do update()
 * - Permite deletedAt para ativar/desativar (admin)
 */
export type UpdateUserCarRepositoryDTO =
	Omit<UpdateUserCarDTO, "id"> & {
	deletedAt?: Date | null;
};

export interface IUserCarRepository {
	/**
	 * ✅ REGRA NOVA:
	 * busca o carro do usuário pela placa (placa pode existir pra outro user).
	 */
	findByLicensePlateAndUserId(
		licensePlate: string,
		userId: number,
		includeInactive?: boolean,
	): Promise<UserCar | null>;

	/**
	 * (Opcional / utilitário)
	 * Se em algum lugar do sistema você precisar buscar "todos" por placa.
	 * Não use isso pra regra de unicidade.
	 */
	findManyByLicensePlate(
		licensePlate: string,
		includeInactive?: boolean,
	): Promise<UserCar[]>;

	findByUserId(userId: number, includeInactive?: boolean): Promise<UserCar[]>;

	findById(id: number, includeInactive?: boolean): Promise<UserCar | null>;

	create(
		data: Omit<UserCar, "id"> & { deletedAt?: Date | null },
	): Promise<UserCar>;

	update(carId: number, data: UpdateUserCarRepositoryDTO): Promise<UserCar>;

	delete(carId: number): Promise<void>;
}
