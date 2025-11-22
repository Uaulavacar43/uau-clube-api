import type { Notification } from "../../entities/Notification";

export interface INotificationRepository {
	save(data: Omit<Notification, "id">): Promise<Notification>;
	saveMany(data: Omit<Notification, "id">[]): Promise<number>;
	list(): Promise<Notification[]>;

	getExpiringSubscriptions(): Promise<
		{
			userId: number;
			userName: string;
			expiryDate: Date | null;
		}[]
	>;
}
