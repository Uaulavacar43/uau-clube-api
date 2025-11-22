import { PrismaNotificationRepository } from "../../repositories/implementations/PrismaNotificationRepository";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { NotificationController } from "./NotificationController";
import { NotificationService } from "./NotificationService";

const notificationRepository = new PrismaNotificationRepository();
const userRepository = new PrismaUserRepository();
const notificationService = new NotificationService(
	notificationRepository,
	userRepository,
);
export const notificationController = new NotificationController(
	notificationService,
);
