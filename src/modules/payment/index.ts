import { PrismaCouponRepository } from "../../repositories/implementations/PrismaCouponRepository";
import { PrismaIndividualServicePurchaseRepository } from "../../repositories/implementations/PrismaIndividualServicePurchaseRepository";
import { PrismaPaymentRepository } from "../../repositories/implementations/PrismaPaymentRepository";
import { PrismaPlanRepository } from "../../repositories/implementations/PrismaPlanRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { PrismaWashServiceRepository } from "../../repositories/implementations/PrismaWashServiceRepository";
import { PaymentController } from "./PaymentController";
import { PaymentService } from "./PaymentService";
import paymentRoutes from "./routes";

const subscriptionRepository = new PrismaSubscriptionRepository();
const userRepository = new PrismaUserRepository();
const planRepository = new PrismaPlanRepository();
const paymentRepository = new PrismaPaymentRepository();
const couponRepository = new PrismaCouponRepository();
const washServiceRepository = new PrismaWashServiceRepository();
const individualServicePurchaseRepository =
	new PrismaIndividualServicePurchaseRepository();
const userCarRepository = new PrismaUserCarRepository();

const paymentService = new PaymentService(
	paymentRepository,
	planRepository,
	userRepository,
	couponRepository,
	subscriptionRepository,
	washServiceRepository,
	individualServicePurchaseRepository,
	userCarRepository,
);
export const paymentController = new PaymentController(paymentService);

export default paymentRoutes;
