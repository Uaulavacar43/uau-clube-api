import type { UserCar } from "../../entities/UserCar";
import type { UpdateUserCarDTO } from "../../modules/userCar/dto/UpdateUserCarDTO";

export interface IUserCarRepository {
	findByLicensePlate(licensePlate: string): Promise<UserCar | null>;
	create(
		data: Omit<UserCar, "id" | "createdAt" | "updatedAt">,
	): Promise<UserCar>;
	findByUserId(userId: number): Promise<UserCar[]>; // Method to list cars by user ID
	findById(id: number): Promise<UserCar | null>; // Method to find a car by its ID
	update(carId: number, data: UpdateUserCarDTO): Promise<UserCar>; // Method to update a car
	delete(carId: number): Promise<void>; // Method to delete a car (if needed in the future)
}
