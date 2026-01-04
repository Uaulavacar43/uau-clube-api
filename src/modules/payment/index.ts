// src/modules/payment/index.ts

import { PrismaPaymentRepository } from "../../repositories/implementations/PrismaPaymentRepository";
import { PrismaPlanRepository } from "../../repositories/implementations/PrismaPlanRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import { PrismaCouponRepository } from "../../repositories/implementations/PrismaCouponRepository";

import { PaymentController } from "./PaymentController";
import paymentRoutes from "./routes";

// use-cases
import { PaymentCreateService } from "./PaymentCreateService";
import { SubscriptionCreateService } from "./SubscriptionCreateService";
import { PaymentQueryService } from "./PaymentQueryService";
import { PaymentMetricsService } from "./PaymentMetricsService";
import { PaymentWebhookService } from "./PaymentWebhookService";

// domain services
import { CouponPricingService } from "./CouponPricingService";
import { PaymentCashbackService } from "./PaymentCashbackService";
import { AsaasBillingService } from "./AsaasBillingService";
import { SubscriptionLifecycleService } from "./SubscriptionLifecycleService";

// ---------------------------------------------------------------------
// Repositories (singletons)
// ---------------------------------------------------------------------
const paymentRepository = new PrismaPaymentRepository();
const planRepository = new PrismaPlanRepository();
const userRepository = new PrismaUserRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();
const userCarRepository = new PrismaUserCarRepository();
const couponRepository = new PrismaCouponRepository();

// ---------------------------------------------------------------------
// Domain services (singletons)
// ---------------------------------------------------------------------
const couponPricingService = new CouponPricingService(couponRepository);
const paymentCashbackService = new PaymentCashbackService();
const asaasBillingService = new AsaasBillingService();

// ✅ lifecycle é um “serviço de orquestração” que depende de repositórios
const subscriptionLifecycleService = new SubscriptionLifecycleService(
	subscriptionRepository,
	planRepository,
	userRepository,
	paymentRepository,
	userCarRepository,
);

// ---------------------------------------------------------------------
// Use-cases (singletons)
// ---------------------------------------------------------------------
const paymentCreateService = new PaymentCreateService(
	couponPricingService,
	paymentCashbackService,
	asaasBillingService,
);

const subscriptionCreateService = new SubscriptionCreateService(
	couponPricingService,
	paymentCashbackService,
	subscriptionLifecycleService,
);

const paymentQueryService = new PaymentQueryService();

// ✅ pelo arquivo que você mandou: não recebe args
const paymentMetricsService = new PaymentMetricsService();

// ✅ pelo arquivo que você mandou: recebe só AsaasBillingService
const paymentWebhookService = new PaymentWebhookService(asaasBillingService);

// ---------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------
export const paymentController = new PaymentController(
	paymentCreateService,
	subscriptionCreateService,
	paymentQueryService,
	paymentMetricsService,
	paymentWebhookService,
);

export default paymentRoutes;
