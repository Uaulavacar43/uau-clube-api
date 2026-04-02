import type { Coupon } from "../../entities/Coupon";
import type { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";
import { Payment } from "../../entities/Payment";
import { PeriodicityType, type Plan } from "../../entities/Plan";
import { Subscription } from "../../entities/Subscription";
import { AppError } from "../../error/AppError";
import type { ICouponRepository } from "../../repositories/interfaces/ICouponRepository";
import type { IIndividualServicePurchaseRepository } from "../../repositories/interfaces/IIndividualServicePurchaseRepository";
import type { IPaymentRepository } from "../../repositories/interfaces/IPaymentRepository";
import type { IPlanRepository } from "../../repositories/interfaces/IPlanRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IWashServiceRepository } from "../../repositories/interfaces/IWashServiceRepository";
import { WelcomeBonusService } from "../welcome-bonus/WelcomeBonusService";
import { asaasGetOrCreateCustomerByCpfCnpj } from "../../utils/asaas/asaasCustomer";
import { ASAAS_EVENT_STATUS_MAP } from "../../utils/asaas/asaasEventMap";
import {
	asaasCreatePayment,
	asaasGetPixQrCode,
} from "../../utils/asaas/asaasPayments";
import { asaasGetOrCreateRandomPixKey } from "../../utils/asaas/asaasPixKeys";
import {
	asaasCreateSubscription,
	asaasListSubscriptionPayments,
	asaasUpdateSubscription,
} from "../../utils/asaas/asaasSubscriptions";
import {
	ASAASPaymentBillingTypeEnum,
	ASAASPaymentStatusEnum,
} from "../../utils/asaas/types/paymentTypes";
import {
	type ASAASCreateSubscriptionDTO,
	ASAASSubscriptionBillingTypeEnum,
	ASAASSubscriptionCycleEnum,
} from "../../utils/asaas/types/subscriptionTypes";
import type { ASAASWebhookEvent } from "../../utils/asaas/types/webhookTypes";
import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";

/**
 * PaymentService que:
 * - Cria/atualiza um Cliente no ASAAS
 * - Configura uma Assinatura com cobrança imediata
 * - Trata eventos de webhook do ASAAS para pagamentos e assinaturas
 * - Persiste entradas de Pagamentos locais
 */
export class PaymentService {
	private welcomeBonusService: WelcomeBonusService;

	constructor(
		private paymentRepository: IPaymentRepository,
		private planRepository: IPlanRepository,
		private userRepository: IUserRepository,
		private couponRepository: ICouponRepository,
		private subscriptionRepository: ISubscriptionRepository,
		private washServiceRepository: IWashServiceRepository,
		private individualServicePurchaseRepository: IIndividualServicePurchaseRepository,
		private carRepository: IUserCarRepository,
	) {
		this.welcomeBonusService = new WelcomeBonusService(userRepository);
	}

	public async createPayment(data: CreatePaymentDTO, userId: number) {
		const loggedUser = await this.userRepository.findById(userId);
		if (!loggedUser) {
			throw new AppError("Usuário não encontrado", 404);
		}

		const cpf =
			data.creditCardHolderInfo?.cpfCnpj ?? data.cpf ?? loggedUser.cpf;
		if (!cpf) {
			throw new AppError(
				"O CPF do usuário é obrigatório para efetuar a compra",
				400,
			);
		}

		const services = await this.washServiceRepository.findManyByIds(
			data.washServices,
		);
		if (services.length === 0) {
			throw new AppError("Nenhum serviço de lavagem foi encontrado", 404);
		}

		const coupon = await this.validateCoupon(
			data.coupon,
			undefined,
			data.washServices,
		);
		const amount = services.reduce(
			(total, service) => total + service.price,
			0,
		);
		const billingTypes = new Map<
			CreatePaymentDTO["type"],
			ASAASPaymentBillingTypeEnum
		>([
			["pix", ASAASPaymentBillingTypeEnum.PIX],
			["creditCard", ASAASPaymentBillingTypeEnum.CREDIT_CARD],
		]);
		const billingType = billingTypes.get(data.type);
		if (!billingType) {
			throw new AppError("Tipo de pagamento inválido", 400);
		}

		const asaasCustomer = await asaasGetOrCreateCustomerByCpfCnpj({
			name: data.creditCardHolderInfo?.name ?? loggedUser.name,
			cpfCnpj: cpf,
			email: data.creditCardHolderInfo?.email ?? loggedUser.email,
			phone: data.creditCardHolderInfo?.phone ?? loggedUser.phone ?? undefined,
			notificationDisabled: true,
		});

		await asaasGetOrCreateRandomPixKey();

		const asaasPayment = await asaasCreatePayment({
			billingType,
			dueDate: new Date().toISOString().split("T")[0],
			value: amount,
			customer: asaasCustomer.id,
			description: `Pagamento serviços avulsos: ${services.map((s) => s.name).join(", ")}`,
			externalReference: JSON.stringify({
				userId,
				couponId: coupon?.id,
			}),
			discount: !coupon
				? undefined
				: {
						value: coupon.discountValue,
						type: coupon.discountType,
					},
			creditCard: data.creditCard,
			creditCardHolderInfo: data.creditCardHolderInfo,
		});

		let pixQrCode: string | null = null;
		let pixPayload: string | null = null;
		if (billingType === ASAASPaymentBillingTypeEnum.PIX) {
			console.log("[createPayment] Recuperando QR code PIX...");
			const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
			pixQrCode = asaasPixCode.encodedImage;
			pixPayload = asaasPixCode.payload;
			console.log({
				pixQrCode,
				pixPayload,
			});
			console.log("[createPayment] QR code PIX recuperado.");
		}

		const payment = await this.paymentRepository.create({
			id: 0,
			userId,
			amount,
			paymentMethodId: billingType.toString(),
			status: "PENDING",
			couponId: coupon?.id,
			paymentDate: new Date(),
			pixQrCode,
			pixPayload,
			createdAt: new Date(),
			updatedAt: new Date(),
			paymentIdAsaas: asaasPayment.id,
		});

		const individualPurchases: IndividualServicePurchase[] = [];
		for (const service of services) {
			const is = await this.individualServicePurchaseRepository.create({
				id: null,
				userId,
				washServiceId: service.id,
				purchaseDate: new Date(),
				status: "PENDING",
				createdAt: new Date(),
				updatedAt: new Date(),
				paymentId: payment.id,
			});

			individualPurchases.push(is);
		}

		// O individualServicePurchase é o pagamento de um serviço de lavagem
		// Deve ser criado um para cada serviço de lavagem
		// O pagamento tem o id obrigatório do plano, deve ser removido esta obrigação

		return {
			payment,
			individualPurchases,
			services,
			amount,
			asaasCustomer,
			coupon,
			loggedUser,
		};
	}

	/**
	 * Cria uma assinatura no ASAAS (mensal ou anual) e
	 * um Pagamento local com status "PENDENTE" (embora a cobrança imediata seja acionada).
	 */
	public async subscribeToPlan(
		data: CreateSubscriptionToPlanDTO,
		userId: number,
	) {
		console.log("[createPayment] Iniciando processo de pagamento...");

		const loggedUser = await this.userRepository.findById(userId);
		if (!loggedUser) {
			throw new AppError("Usuário não encontrado", 404);
		}

		const cpf =
			data.creditCardHolderInfo?.cpfCnpj ?? data.cpf ?? loggedUser.cpf;
		if (!cpf) {
			throw new AppError(
				"O CPF do usuário é obrigatório para efetuar a compra",
				400,
			);
		}

		const plan = await this.planRepository.findById(data.plan_id);
		if (!plan) {
			throw new AppError("Plano não encontrado", 404);
		}

		const car = await this.carRepository.findById(data.carId);
		if (!car) {
			throw new AppError("Carro não encontrado", 404);
		}

		const coupon = await this.validateCoupon(data.coupon, plan.id);

		// Bônus de boas-vindas
		const welcomeBonus = this.welcomeBonusService.calculateBonus(
			new Date(loggedUser.createdAt),
			loggedUser.welcomeBonusUsed ?? false,
		);

		// 3) Se o carro já tem assinatura, tocar erro
		const hasSubscription = await this.carHasSubscription(car.licensePlate);
		if (hasSubscription) {
			throw new AppError(
				"Este carro já tem assinatura, caso queira alterar o plano do carro, cancele a assinatura atual",
				400,
			);
		}

		const billingPaymentTypes = new Map<
			CreatePaymentDTO["type"],
			ASAASPaymentBillingTypeEnum
		>([
			["pix", ASAASPaymentBillingTypeEnum.PIX],
			["creditCard", ASAASPaymentBillingTypeEnum.CREDIT_CARD],
		]);
		const billingPaymentType = billingPaymentTypes.get(data.type);
		if (!billingPaymentType) {
			throw new AppError("Tipo de pagamento inválido", 400);
		}

		const billingSubscriptionTypes = new Map<
			CreatePaymentDTO["type"],
			ASAASSubscriptionBillingTypeEnum
		>([
			["pix", ASAASSubscriptionBillingTypeEnum.PIX],
			["creditCard", ASAASSubscriptionBillingTypeEnum.CREDIT_CARD],
		]);
		const billingSubscriptionType = billingSubscriptionTypes.get(data.type);
		if (!billingSubscriptionType) {
			throw new AppError("Tipo de pagamento inválido", 400);
		}

		// 5) Se existir o cliente no ASAAS atualiza ele, se não existir, cria
		const cpfCnpj = data.creditCardHolderInfo?.cpfCnpj ?? cpf;
		const customerEmail = data.creditCardHolderInfo?.email ?? loggedUser.email;
		const customerPhone = data.creditCardHolderInfo?.phone ?? loggedUser.phone;
		
		console.log("[subscribeToPlan] Dados do cliente para ASAAS:", {
			name: loggedUser.name,
			cpfCnpj: cpfCnpj ? `${cpfCnpj.substring(0, 3)}***` : "NÃO FORNECIDO",
			email: customerEmail,
			phone: customerPhone,
			hasCreditCardHolderInfo: !!data.creditCardHolderInfo,
		});

		if (!cpfCnpj || cpfCnpj.trim() === "") {
			console.error("[subscribeToPlan] CPF/CNPJ não fornecido ou vazio");
			throw new AppError(
				"CPF/CNPJ é obrigatório para criar o cliente no ASAAS",
				400,
			);
		}

		if (!customerEmail || customerEmail.trim() === "") {
			console.error("[subscribeToPlan] Email não fornecido ou vazio");
			throw new AppError(
				"Email é obrigatório para criar o cliente no ASAAS",
				400,
			);
		}

		console.log("[subscribeToPlan] Criando/buscando cliente no ASAAS...");
		let asaasCustomer;
		try {
			asaasCustomer = await asaasGetOrCreateCustomerByCpfCnpj({
				name: loggedUser.name,
				cpfCnpj: cpfCnpj,
				email: customerEmail,
				phone: customerPhone,
				postalCode: data.creditCardHolderInfo?.postalCode,
				addressNumber: data.creditCardHolderInfo?.addressNumber,
				mobilePhone:
					data.creditCardHolderInfo?.mobilePhone ??
					data.creditCardHolderInfo?.phone,
				notificationDisabled: false,
			});
		} catch (error) {
			console.error("[subscribeToPlan] Erro ao criar/buscar cliente no ASAAS:", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			// Se for um AppError, relançar (já tem mensagem apropriada)
			if (error instanceof AppError) {
				throw error;
			}
			// Caso contrário, lançar erro genérico
			throw new AppError(
				"Erro ao gerar pagamento PIX: Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de assinar.",
				400,
			);
		}

		// Validar se o customerId foi retornado corretamente
		if (!asaasCustomer?.id) {
			console.error(
				"[subscribeToPlan] Erro: asaasCustomer não possui id válido",
				{
					asaasCustomer: asaasCustomer ? JSON.stringify(asaasCustomer) : "null/undefined",
					hasId: !!asaasCustomer?.id,
					customerKeys: asaasCustomer ? Object.keys(asaasCustomer) : [],
				},
			);
			throw new AppError(
				"Erro ao gerar pagamento PIX: Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de assinar.",
				400,
			);
		}

		console.log("[subscribeToPlan] Cliente ASAAS criado/buscado com sucesso:", {
			customerId: asaasCustomer.id,
			customerName: asaasCustomer.name,
		});

		// 6) Criar assinatura no ASAAS com cobrança imediata
		console.log("[createPayment] Criando assinatura no ASAAS...");

		const is100PercentDiscount =
			coupon?.discountType === "PERCENTAGE"
				? coupon.discountValue === 100
				: (coupon?.discountValue ?? 0) >= plan.price;

		const timeZoneOffset = data.timeZoneOffset ?? -180;
		const dateWithTimeZone = new Date();
		dateWithTimeZone.setMinutes(dateWithTimeZone.getMinutes() + timeZoneOffset);

		if (is100PercentDiscount) {
			let expiresAt: Date | null = null;
			if (plan.periodicityType === PeriodicityType.QUARTERLY) {
				expiresAt = dateWithTimeZone;
				expiresAt.setMonth(expiresAt.getMonth() + 3);
			}
			if (plan.periodicityType === PeriodicityType.SEMIANNUALLY) {
				expiresAt = dateWithTimeZone;
				expiresAt.setMonth(expiresAt.getMonth() + 6);
			}
			if (plan.periodicityType === PeriodicityType.YEAR) {
				expiresAt = dateWithTimeZone;
				expiresAt.setFullYear(expiresAt.getFullYear() + 1);
			}
			if (plan.extraMonths && expiresAt) {
				expiresAt.setMonth(expiresAt.getMonth() + plan.extraMonths);
			}

			const subscription = await this.subscriptionRepository.create(
				new Subscription({
					userId: loggedUser.id,
					planId: plan.id,
					planType: String(plan.periodicityType),
					amount: plan.price,
					isActive: true,
					startDate: dateWithTimeZone,
					carId: data.carId,
					expiresAt,
					paymentMethod: billingPaymentType,
					// installmentIdAsaas: asaasPayment.installment ? asaasPayment.installment : null,
					couponId: coupon?.id,
				}),
			);

			const payment = await this.paymentRepository.create({
				id: 0,
				userId,
				planId: plan.id,
				amount: 0,
				status: "PAID",
				installments: null,
				paymentDate: dateWithTimeZone,
				createdAt: dateWithTimeZone,
				updatedAt: dateWithTimeZone,
				paymentIdAsaas: "Cupom cobriu o custo",
				couponId: coupon?.id,
				pixQrCode: null,
				pixPayload: null,
			});

			return {
				subscription,
				payment,
			};
		}

		if (plan.isPackage) {
			// throw new AppError('Plano no formato pacote não suportado, entre em contato com o suporte', 400);
			console.log(
				`[createPayment] Plano no formato pacote, periodicidade: ${plan.periodicityType}`,
			);
			if (
				!data.installments &&
				billingSubscriptionType === ASAASSubscriptionBillingTypeEnum.CREDIT_CARD
			) {
				throw new AppError("O número de parcelas deve ser informado", 400);
			}

			this.validatePlanInstallments(plan, data.installments);

			let expiresAt: Date | null = null;
			if (plan.periodicityType === PeriodicityType.MONTH) {
				expiresAt = new Date(dateWithTimeZone);
				expiresAt.setMonth(expiresAt.getMonth() + 1);
			} else if (plan.periodicityType === PeriodicityType.QUARTERLY) {
				expiresAt = new Date(dateWithTimeZone);
				expiresAt.setMonth(expiresAt.getMonth() + 3);
			} else if (plan.periodicityType === PeriodicityType.SEMIANNUALLY) {
				expiresAt = new Date(dateWithTimeZone);
				expiresAt.setMonth(expiresAt.getMonth() + 6);
			} else if (plan.periodicityType === PeriodicityType.YEAR) {
				expiresAt = new Date(dateWithTimeZone);
				expiresAt.setFullYear(expiresAt.getFullYear() + 1);
			}
			if (plan.extraMonths && expiresAt) {
				expiresAt.setMonth(expiresAt.getMonth() + plan.extraMonths);
			}

			const subscription = await this.subscriptionRepository.create(
				new Subscription({
					userId: loggedUser.id,
					planId: plan.id,
					planType: String(plan.periodicityType),
					amount: plan.price,
					isActive: false,
					startDate: dateWithTimeZone,
					carId: data.carId,
					expiresAt,
					paymentMethod: billingPaymentType,
					// installmentIdAsaas: asaasPayment.installment ? asaasPayment.installment : null,
					couponId: coupon?.id,
				}),
			);

			// Calcula desconto total (cupom + bônus boas-vindas)
			const packageCouponDiscount = coupon
				? coupon.discountType === "PERCENTAGE"
					? (plan.price * coupon.discountValue) / 100
					: coupon.discountValue
				: 0;
			const packageDiscountedPrice = Math.max(
				0,
				plan.price - packageCouponDiscount - welcomeBonus,
			);

			const asaasPayment = await asaasCreatePayment({
				billingType: billingPaymentType,
				dueDate: dateWithTimeZone.toISOString().split("T")[0],
				value: packageDiscountedPrice,
				installmentCount: data.installments
					? data.installments > 1
						? data.installments
						: undefined
					: undefined,
				totalValue: data.installments
					? data.installments > 1
						? packageDiscountedPrice
						: undefined
					: undefined,
				customer: asaasCustomer.id,
				description: `Pagamento plano no formato pacote: ${plan.name}`,
				externalReference: JSON.stringify({
					userId,
					couponId: coupon?.id,
					planId: plan.id,
					subId: subscription.id,
					welcomeBonusAmount: welcomeBonus > 0 ? welcomeBonus : undefined,
				}),
			creditCard: data.creditCard,
				creditCardHolderInfo: data.creditCardHolderInfo,
			});

			subscription.installmentIdAsaas = asaasPayment.installment
				? asaasPayment.installment
				: null;

			let pixQrCode: string | null = null;
			let pixPayload: string | null = null;
			if (billingPaymentType === ASAASPaymentBillingTypeEnum.PIX) {
				console.log("[createPayment] Recuperando QR code PIX...");
				const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
				pixQrCode = asaasPixCode.encodedImage;
				pixPayload = asaasPixCode.payload;
				console.log({
					pixQrCode,
					pixPayload,
				});
				console.log("[createPayment] QR code PIX recuperado.");
			}

			const payment = await this.paymentRepository.create({
				id: 0,
				userId,
				planId: plan.id,
				amount: plan.price,
				status:
					asaasPayment.status === ASAASPaymentStatusEnum.CONFIRMED
						? "PAID"
						: "PENDING",
				installments: data.installments,
				paymentDate: dateWithTimeZone,
				createdAt: dateWithTimeZone,
				updatedAt: dateWithTimeZone,
				paymentIdAsaas: asaasPayment.id,
				couponId: coupon?.id,
				pixQrCode,
				pixPayload,
			});
			const createdSubscription = await this.subscriptionRepository.update(
				subscription.id,
				subscription,
			);

			return {
				subscription: createdSubscription,
				payment,
				asaasPayment,
			};
		} else {
			const result = await this.createAsaasSubscription(
				{
					...data,
					userId,
				},
				plan,
				asaasCustomer.id,
				coupon,
				billingSubscriptionType,
				welcomeBonus,
			);

			if (!result || !result.subscription) {
				throw new AppError("Falha ao criar assinatura", 400);
			}
			console.log(
				"[createPayment] Assinatura criada no ASAAS:",
				result.subscription.id,
			);

			return {
				subscription: result.subscription,
				payment: result.payment,
			};
		}
	}

	/**
	 * Validar cupom
	 */
	private async validateCoupon(
		code?: string,
		planId?: number,
		serviceIds?: number[],
	) {
		if (!code) return null;

		const coupon = await this.couponRepository.findByCode(code);
		if (!coupon) {
			throw new AppError("Cupom inválido", 404);
		}

		if (!coupon.isActive) {
			throw new AppError("Cupom inválido", 400);
		}
		if (this.couponRepository.isExpired(coupon)) {
			throw new AppError("Cupom inválido", 400);
		}
		if (this.couponRepository.isNotStarted(coupon)) {
			throw new AppError("Cupom inválido", 400);
		}
		if (this.couponRepository.hasReachedUsageLimit(coupon)) {
			throw new AppError("Cupom inválido", 400);
		}
		const hasPlansRelation = (coupon.plans?.length ?? 0) > 0;
		if (
			!hasPlansRelation &&
			planId &&
			!coupon.plans?.some((plan) => plan.id === planId)
		) {
			throw new AppError("Cupom inválido", 400);
		}
		const hasServicesRelation = (coupon.services?.length ?? 0) > 0;
		if (
			!hasServicesRelation &&
			serviceIds &&
			!coupon.services?.some((service) => serviceIds?.includes(service.id))
		) {
			throw new AppError("Cupom inválido", 400);
		}

		return coupon;
	}

	private validatePlanInstallments(plan: Plan, installments?: number) {
		// Validação de parcelas para planos anuais
		if (
			plan.periodicityType === PeriodicityType.YEAR &&
			installments &&
			installments > 12
		) {
			throw new AppError("O plano anual não pode ter mais de 12 parcelas", 400);
		}

		// Validação de parcelas para planos semestrais
		if (
			plan.periodicityType === PeriodicityType.SEMIANNUALLY &&
			installments &&
			installments > 6
		) {
			throw new AppError(
				"O plano semestral não pode ter mais de 6 parcelas",
				400,
			);
		}

		// Validação de parcelas para planos trimestrais
		if (
			plan.periodicityType === PeriodicityType.QUARTERLY &&
			installments &&
			installments > 3
		) {
			throw new AppError(
				"O plano trimestral não pode ter mais de 3 parcelas",
				400,
			);
		}

		// Validação de parcelas para planos mensais
		if (
			plan.periodicityType === PeriodicityType.MONTH &&
			installments &&
			installments > 1
		) {
			throw new AppError(
				"O plano mensal não pode ter mais de 1 parcela",
				400,
			);
		}

		return true;
	}

	/**
	 * Manipulador de webhook do ASAAS (pagamentos ou assinaturas).
	 * Sempre retorna status 200 OK com uma mensagem curta.
	 */
	public async paymentWebhook(body: ASAASWebhookEvent) {
		try {
			console.info(
				"[paymentWebhook] Webhook recebido:",
				JSON.stringify(body, null, 2),
			);

			const { event } = body;
			if (!event) {
				console.warn("[paymentWebhook] Nenhum evento no corpo da requisição.");
				return {
					status: 200,
					message: "Nenhum evento encontrado no webhook do ASAAS",
				};
			}

			const newStatus = ASAAS_EVENT_STATUS_MAP[event];
			if (!newStatus) {
				console.warn("[paymentWebhook] Evento não tratado:", event);
				return { status: 200, message: `Evento não processado: ${event}` };
			}

			// Processamento de assinatura
			if (body.subscription?.id) {
				await this.handleSubscriptionWebhook(body, newStatus);
			}

			// Processamento de pagamento
			if (body.payment?.id) {
				await this.handlePaymentWebhook(body, newStatus);
			}

			return { status: 200, message: "Webhook processado com sucesso" };
		} catch (error) {
			console.error("[paymentWebhook] Erro inesperado:", error);
			return { status: 200, message: "Erro interno", error };
		}
	}

	/**
	 * Cancela uma assinatura ativa, se existir (chama o cancelamento no ASAAS e marca a assinatura local como inativa).
	 */
	private async carHasSubscription(licensePlate: string) {
		const existingSubscription =
			await this.subscriptionRepository.findByCarLicensePlate(licensePlate);
		if (!existingSubscription || !existingSubscription.isActive) return false;

		return true;
	}

	/**
	 * Cria a assinatura no ASAAS com cobrança imediata.
	 */
	private async createAsaasSubscription(
		data: CreateSubscriptionToPlanDTO & { userId: number },
		plan: Plan,
		customerId: string,
		coupon: Coupon | null,
		billingType: ASAASSubscriptionBillingTypeEnum,
		welcomeBonus = 0,
	) {
		try {
			const mapCycle = new Map<PeriodicityType, ASAASSubscriptionCycleEnum>([
				[PeriodicityType.WEEK, ASAASSubscriptionCycleEnum.WEEKLY],
				[PeriodicityType.MONTH, ASAASSubscriptionCycleEnum.MONTHLY],
				[PeriodicityType.QUARTERLY, ASAASSubscriptionCycleEnum.QUARTERLY],
				[PeriodicityType.SEMIANNUALLY, ASAASSubscriptionCycleEnum.SEMIANNUALLY],
				[PeriodicityType.YEAR, ASAASSubscriptionCycleEnum.YEARLY],
			]);

			const cycle = mapCycle.get(plan.periodicityType);
			if (!cycle) {
				throw new AppError(
					`Este período de assinatura não existe ou não é permitido neste formato: ${plan.periodicityType}`,
					400,
				);
			}

			const subscription = await this.subscriptionRepository.create(
				new Subscription({
					userId: data.userId,
					planId: plan.id,
					planType: String(plan.periodicityType), // Usa o enum PeriodicityType (MONTH, WEEK, YEAR, etc.) ao invés do enum do ASAAS
					amount: plan.price,
					isActive: false,
					startDate: new Date(),
					carId: data.carId,
					// endDate: new Date(asaasSubscription.nextDueDate),
					paymentMethod: billingType,
					subscriptionIdAsaas: null,
					couponId: coupon?.id,
				}),
			);

			// Calcula desconto do cupom para o valor inicial
			const couponDiscount = coupon
				? coupon.discountType === "PERCENTAGE"
					? (plan.price * coupon.discountValue) / 100
					: coupon.discountValue
				: 0;

			// Valor da 1ª cobrança = preço do plano - desconto cupom - bônus boas-vindas
			const firstChargeValue = Math.max(
				0,
				plan.price - couponDiscount - welcomeBonus,
			);

			// Preparar o payload da assinatura do ASAAS
			const payload: ASAASCreateSubscriptionDTO = {
				customer: customerId,
				nextDueDate: new Date().toISOString().split("T")[0], // cobrança imediata
				value: firstChargeValue,
				billingType,
				cycle,
				description: `Plano: ${plan.name}`,
				externalReference: JSON.stringify({
					userId: data.userId,
					planId: plan.id,
					couponId: coupon?.id,
					subId: subscription.id,
					welcomeBonusAmount: welcomeBonus > 0 ? welcomeBonus : undefined,
					planFullPrice: plan.price,
				}),

				// dados do cartão de crédito
				creditCard: !data.creditCard
					? undefined
					: {
							holderName: data.creditCard.holderName,
							number: data.creditCard.number,
							expiryMonth: data.creditCard.expiryMonth,
							expiryYear: data.creditCard.expiryYear,
							ccv: data.creditCard.ccv,
						},

				// dados do titular do cartão
				creditCardHolderInfo: !data.creditCardHolderInfo
					? undefined
					: {
							name: data.creditCardHolderInfo.name,
							email: data.creditCardHolderInfo.email,
							cpfCnpj: data.creditCardHolderInfo.cpfCnpj,
							phone: data.creditCardHolderInfo.phone,
							postalCode: data.creditCardHolderInfo.postalCode,
							addressNumber: data.creditCardHolderInfo.addressNumber,
							addressComplement:
								data.creditCardHolderInfo.addressComplement ?? "",
							mobilePhone:
								data.creditCardHolderInfo.mobilePhone ??
								data.creditCardHolderInfo.phone,
						},
			};

			console.log(
				"[createAsaasSubscription] Payload da assinatura:",
				JSON.stringify(payload, null, 2),
			);
			const asaasSubscription = await asaasCreateSubscription(
				payload,
				customerId,
			);

			subscription.subscriptionIdAsaas = asaasSubscription.id;
			subscription.amount = plan.price; // salva o preço cheio do plano localmente
			subscription.paymentMethod = billingType;
			await this.subscriptionRepository.update(subscription.id, subscription);

			// Se houve bônus de boas-vindas, restaura o valor cheio da assinatura no Asaas
			// para que a 2ª cobrança em diante seja no preço normal.
			if (welcomeBonus > 0 || couponDiscount > 0) {
				try {
					await asaasUpdateSubscription(asaasSubscription.id, {
						value: plan.price,
					});
					console.log(
						`[createAsaasSubscription] Valor da assinatura restaurado para R$${plan.price} após 1ª cobrança com desconto.`,
					);
				} catch (updateError) {
					console.error(
						"[createAsaasSubscription] Erro ao restaurar valor da assinatura:",
						updateError,
					);
				}
			}

			let pixQrCode: string | null = null;
			let pixPayload: string | null = null;
			if (billingType === ASAASSubscriptionBillingTypeEnum.PIX) {
				console.log(
					"[createPayment] Recuperando lista de pagamentos da assinatura...",
				);
				const paymentList = await asaasListSubscriptionPayments(
					asaasSubscription.id,
				);
				const payment = paymentList.data[0];
				if (!payment) {
					console.error(
						"[createPayment] Nenhum pagamento encontrado para a assinatura.",
					);
					throw new AppError(
						"Nenhum pagamento encontrado para a assinatura. Tente novamente.",
						400,
					);
				}
				console.log("[createPayment] Recuperando QR code PIX...");
				const asaasPixCode = await asaasGetPixQrCode(payment.id);
				pixQrCode = asaasPixCode.encodedImage;
				pixPayload = asaasPixCode.payload;
				console.log({
					pixQrCode,
					pixPayload,
				});
				console.log("[createPayment] QR code PIX recuperado.");

				const dbPayment = await this.paymentRepository.create(
					new Payment({
						userId: data.userId,
						planId: plan.id,
						couponId: coupon?.id,
						amount: plan.price,
						status: "PENDING",
						paymentMethodId: payload.billingType,
						paymentIdAsaas: payment.id,
						pixQrCode,
						pixPayload,
					}),
				);

				return {
					subscription: asaasSubscription,
					payment: dbPayment,
				};
			}

			return { subscription: asaasSubscription, payment: null };
		} catch (error) {
			console.error(
				"[createAsaasSubscription] Erro ao criar assinatura:",
				error,
			);
			// Se for um AppError, relançar para que seja tratado pelo middleware de erro
			if (error instanceof AppError) {
				throw error;
			}
			// Se for um erro do ASAAS (já tratado pelo handleAsaasError), relançar
			throw new AppError(
				error instanceof Error
					? error.message
					: "Erro ao criar assinatura no ASAAS",
				400,
			);
		}
	}

	/**
	 * Evento de assinatura do webhook do ASAAS (ex. SUBSCRIPTION_CREATED, SUBSCRIPTION_UPDATED).
	 * Se a assinatura for cancelada ou estiver pendente => marca local como inativa.
	 */
	private async handleSubscriptionWebhook(
		body: ASAASWebhookEvent,
		newStatus: string,
	) {
		const subscriptionAsaasId = body.subscription?.id;
		if (!subscriptionAsaasId) return;

		const localSubscription =
			await this.subscriptionRepository.getByAsaasId(subscriptionAsaasId);
		if (!localSubscription) {
			console.log(
				`[Asaas Webhook] Assinatura ${subscriptionAsaasId} não encontrada localmente.`,
			);
			return;
		}

		if (newStatus === "CANCELED" || newStatus === "PENDING") {
			localSubscription.isActive = false;
			await this.subscriptionRepository.update(
				localSubscription.id,
				localSubscription,
			);
		}

		// Processamento de criação de assinatura
		if (body.event === "SUBSCRIPTION_CREATED" && body.subscription) {
			console.info(
				`[handleSubscriptionWebhook] Processando criação de assinatura ${body.subscription.id}`,
			);

			const externalReference = JSON.parse(
				body.subscription.externalReference || "",
			);
			const { userId, planId, couponId } = externalReference as {
				userId?: number;
				planId?: number;
				couponId?: number;
			};

			if (!userId || !planId) {
				console.error(
					"[handleSubscriptionWebhook] Erro ao extrair userId ou planId da referência externa.",
				);
				return {
					status: 400,
					message: "Referência externa inválida na assinatura",
				};
			}

			const existingSubscription =
				await this.subscriptionRepository.getByAsaasId(body.subscription.id);
			if (existingSubscription) {
				console.info(
					`[handleSubscriptionWebhook] Assinatura já existe no banco de dados: ${body.subscription.id}`,
				);
				return { status: 200, message: "Assinatura já registrada" };
			}

			console.info(
				`[handleSubscriptionWebhook] Registrando nova assinatura no banco de dados para userId: ${userId}, planId: ${planId}`,
			);

			const asaasToDbCycleMap = new Map<string, string>([
				[ASAASSubscriptionCycleEnum.WEEKLY, PeriodicityType.WEEK],
				[ASAASSubscriptionCycleEnum.MONTHLY, PeriodicityType.MONTH],
				[ASAASSubscriptionCycleEnum.QUARTERLY, PeriodicityType.QUARTERLY],
				[ASAASSubscriptionCycleEnum.SEMIANNUALLY, PeriodicityType.SEMIANNUALLY],
				[ASAASSubscriptionCycleEnum.YEARLY, PeriodicityType.YEAR],
			]);

			const planType = asaasToDbCycleMap.get(body.subscription.cycle) || body.subscription.cycle;
			if (!asaasToDbCycleMap.has(body.subscription.cycle)) {
				console.warn(
					`[handleSubscriptionWebhook] Ciclo do ASAAS não mapeado: ${body.subscription.cycle}, usando valor original`,
				);
			}

			const newSubscription = new Subscription({
				userId,
				planId,
				planType,
				amount: body.subscription.value,
				isActive: true,
				startDate: new Date(),
				endDate: new Date(body.subscription.nextDueDate),
				paymentMethod: body.subscription.billingType,
				subscriptionIdAsaas: body.subscription.id,
			});

			await this.subscriptionRepository.create(newSubscription);
			console.info(
				`[handleSubscriptionWebhook] Assinatura salva com sucesso no banco de dados: ${body.subscription.id}`,
			);

			return { status: 200, message: "Assinatura processada com sucesso" };
		}
	}

	/**
	 * Evento de pagamento do webhook do ASAAS (ex. PAYMENT_CONFIRMED, PAYMENT_OVERDUE).
	 */
	private async handlePaymentWebhook(
		body: ASAASWebhookEvent,
		newStatus: string,
	) {
		try {
			console.log("[handlePaymentWebhook] Processando webhook de pagamento...");

			if (!body.payment) {
				console.warn("[handlePaymentWebhook] body.payment está indefinido");
				return { status: 200, message: "Sem dados de pagamento" };
			}

			const paymentAsaasId = body.payment.id;
			if (!paymentAsaasId) {
				console.warn("[handlePaymentWebhook] payment.id está indefinido");
				return { status: 200, message: "ID de pagamento não encontrado" };
			}

			// Valor do pagamento
			const amount = Number(body.payment.value) || 0;

			let { userId, planId, couponId, subId, welcomeBonusAmount } = JSON.parse(
				body.payment.externalReference || "",
			) as {
				userId?: number;
				planId?: number;
				couponId?: number;
				subId?: number;
				welcomeBonusAmount?: number;
			};

			console.log(
				`[handlePaymentWebhook] userId inicial: ${userId}, planId inicial: ${planId}, couponId inicial: ${couponId}`,
			);

			if (!userId && body.payment?.subscription) {
				console.log(
					"[handlePaymentWebhook] Procurando usuário a partir da assinatura local...",
				);
				const localSub = await this.subscriptionRepository.getByAsaasId(
					body.payment.subscription,
				);
				if (localSub) {
					userId = localSub.userId;
					planId = localSub.planId;
				}
			}

			if (userId) {
				const userExists = await this.userRepository.findById(userId);
				if (!userExists) {
					console.error(
						`[handlePaymentWebhook] Usuário ID ${userId} não encontrado. Pulando inserção de pagamento.`,
					);
					return {
						status: 200,
						message: `Usuário ID ${userId} não encontrado`,
					};
				}
			} else {
				console.warn(
					"[handlePaymentWebhook] userId é 0 ou nulo. Pulando inserção de pagamento.",
				);
				return {
					status: 200,
					message: "Nenhum userId encontrado para associar o pagamento",
				};
			}

			if (planId === 0 && body.payment?.subscription) {
				console.log(
					"[handlePaymentWebhook] Procurando plano a partir da assinatura local...",
				);
				const localSub = await this.subscriptionRepository.getByAsaasId(
					body.payment.subscription,
				);
				if (localSub) {
					planId = localSub.planId;
					subId = localSub.id;
				}
			}

			if (planId) {
				const planExists = await this.planRepository.findById(planId);
				if (!planExists) {
					console.error(
						`[handlePaymentWebhook] Plano ID ${planId} não encontrado. Pulando inserção.`,
					);
					return { status: 200, message: `Plano ID ${planId} não encontrado` };
				}
			}

			if (couponId) {
				const couponExists = await this.couponRepository.findById(couponId);
				if (!couponExists) {
					console.error(
						`[handlePaymentWebhook] Cupom ID ${couponId} não encontrado. Pulando inserção.`,
					);
					return {
						status: 200,
						message: `Cupom ID ${couponId} não encontrado`,
					};
				}
			}

			if (subId) {
				const subscription = await this.subscriptionRepository.findById(subId);
				if (subscription) {
					userId = subscription.userId;
					planId = subscription.planId;
					subId = subscription.id;
				}
			}

			const existingPayment =
				await this.paymentRepository.getByAsaasId(paymentAsaasId);

			console.log(
				`[handlePaymentWebhook] ${existingPayment ? "Atualizando" : "Registrando"} pagamento => userId: ${userId}, planId: ${planId}, couponId: ${couponId}, amount: ${amount}, status: ${newStatus}`,
			);

			const newPayment = new Payment({
				userId,
				planId,
				couponId,
				amount,
				status: newStatus as "PAID" | "PENDING" | "CANCELED",
				paymentDate: new Date(),
				paymentIdAsaas: paymentAsaasId,
				paymentMethodId: body.payment.installment,
			});

			if (existingPayment) {
				await this.paymentRepository.update(
					{ id: existingPayment.id },
					newPayment,
					true,
				);
			} else {
				await this.paymentRepository.create(newPayment);
			}

			if (body.payment.subscription || subId) {
				let subscription: Subscription | null = null;
				if (body.payment.subscription) {
					subscription = await this.subscriptionRepository.getByAsaasId(
						body.payment.subscription,
					);
				}
				if (subId) {
					subscription = await this.subscriptionRepository.findById(subId);
				}
				if (subscription) {
					let isActive = false;
					if (newStatus === "PAID") {
						isActive = true;
					}
					subscription.isActive = isActive;
					await this.subscriptionRepository.update(
						subscription.id,
						subscription,
					);

					console.log(
						`[handlePaymentWebhook] Assinatura ${subscription.id} atualizada com sucesso => isActive: ${isActive}`,
					);
				}
			}

			if (body.payment.installment) {
				const subscription =
					await this.subscriptionRepository.getByInstallmentIdAsaas(
						body.payment.installment,
					);
				if (subscription) {
					let isActive = false;
					if (newStatus === "PAID") {
						isActive = true;
					}
					subscription.isActive = isActive;
					await this.subscriptionRepository.update(
						subscription.id,
						subscription,
					);

					console.log(
						`[handlePaymentWebhook] Assinatura ${body.payment.installment} atualizada com sucesso => isActive: ${isActive}`,
					);
				}
			}

			// Marca o bônus de boas-vindas como usado após 1ª cobrança confirmada
			if (
				newStatus === "PAID" &&
				welcomeBonusAmount &&
				welcomeBonusAmount > 0 &&
				userId
			) {
				try {
					const user = await this.userRepository.findById(userId);
					if (user && !user.welcomeBonusUsed) {
						await this.userRepository.update(userId, {
							welcomeBonusUsed: true,
						});
						console.log(
							`[handlePaymentWebhook] Bônus de boas-vindas marcado como usado para userId: ${userId}`,
						);
					}
				} catch (bonusError) {
					console.error(
						"[handlePaymentWebhook] Erro ao marcar bônus como usado:",
						bonusError,
					);
				}
			}

			console.log(
				`[handlePaymentWebhook] Pagamento armazenado com sucesso: ${paymentAsaasId}`,
			);

			return {
				status: 200,
				message: "Pagamento processado com sucesso",
				newStatus,
			};
		} catch (error) {
			console.error("[handlePaymentWebhook] Erro inesperado:", error);
			return { status: 200, message: "Erro interno", error };
		}
	}

	public async getMonthlyRevenueHistory() {
		return this.paymentRepository.getMonthlyRevenueHistory();
	}

	public async getYearlyRevenueHistory() {
		return this.paymentRepository.getYearlyRevenueHistory();
	}

	public async updatePaymentStatus(
		paymentId: number,
		status: "PAID" | "PENDING" | "CANCELED",
	) {
		await this.paymentRepository.updatePaymentStatus(paymentId, status);
	}

	public async getTotalRevenue() {
		return this.paymentRepository.getTotalRevenue();
	}

	public async getCurrentMonthRevenue() {
		return this.paymentRepository.getCurrentMonthRevenue();
	}

	public async getNextMonthPredictedRevenue() {
		return this.paymentRepository.getNextMonthPredictedRevenue();
	}

	public async getAllPaymentsWithDetails(data: GetAllPaymentsWithDetailsDTO) {
		return this.paymentRepository.getAllPaymentsWithDetails(data);
	}

	public async getPaymentDetailsById(paymentId: number) {
		return this.paymentRepository.getPaymentDetailsById(paymentId);
	}

	public async getMRR() {
		return this.paymentRepository.getMRR();
	}
}
