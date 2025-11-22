import type { Coupon } from "../../entities/Coupon";
import { AppError } from "../../error/AppError";
import type { ICouponRepository } from "../../repositories/interfaces/ICouponRepository";
import type { CreateCouponDTO } from "./dto/CreateCouponDTO";
import type { UpdateCouponDTO } from "./dto/UpdateCouponDTO";

export class CouponService {
	constructor(private couponRepository: ICouponRepository) {}

	public async createCoupon(data: CreateCouponDTO): Promise<Coupon> {
		// Validar datas
		const validFrom = new Date(data.validFrom);
		const validUntil = new Date(data.validUntil);

		if (validFrom >= validUntil) {
			throw new AppError(
				"A data de início deve ser anterior à data de término",
				400,
			);
		}

		// if (validFrom < new Date()) {
		// 	throw new AppError('A data de início não pode ser no passado', 400);
		// }

		// Validar valores de desconto
		if (data.discountType === "PERCENTAGE") {
			const percentage = Number(data.discountValue);
			if (percentage > 100) {
				throw new AppError(
					"O desconto percentual não pode ser maior que 100%",
					400,
				);
			}
		}

		return await this.couponRepository.create(data);
	}

	public async listCoupons(): Promise<Coupon[]> {
		return await this.couponRepository.findAll();
	}

	public async getCouponById(id: number): Promise<Coupon> {
		const coupon = await this.couponRepository.findById(id, {
			plans: true,
			services: true,
		});
		if (!coupon) {
			throw new AppError("Cupom não encontrado", 404);
		}
		return coupon;
	}

	public async updateCoupon(
		id: number,
		data: UpdateCouponDTO,
	): Promise<Coupon> {
		const existingCoupon = await this.couponRepository.findById(id);
		if (!existingCoupon) {
			throw new AppError("Cupom não encontrado", 404);
		}

		// Validar datas se estiverem sendo atualizadas
		if (data.validFrom || data.validUntil) {
			const validFrom = data.validFrom
				? new Date(data.validFrom)
				: existingCoupon.validFrom;
			const validUntil = data.validUntil
				? new Date(data.validUntil)
				: existingCoupon.validUntil;

			if (validFrom >= validUntil) {
				throw new AppError(
					"A data de início deve ser anterior à data de término",
					400,
				);
			}

			// const today = new Date();
			// today.setDate(today.getDate() - 1);
			// if (validFrom < today) {
			// 	throw new AppError("A data de início não pode ser no passado", 400);
			// }
		}

		// Validar valores de desconto se estiverem sendo atualizados
		if (data.discountValue && data.discountType === "PERCENTAGE") {
			const percentage = Number(data.discountValue);
			if (percentage > 100) {
				throw new AppError(
					"O desconto percentual não pode ser maior que 100%",
					400,
				);
			}
		}

		return await this.couponRepository.update(id, data);
	}

	public async deleteCoupon(id: number): Promise<void> {
		const coupon = await this.couponRepository.findById(id);
		if (!coupon) {
			throw new AppError("Cupom não encontrado", 404);
		}
		await this.couponRepository.delete(id);
	}

	public async validateCoupon(
		code: string,
		planId?: number,
		servicesIds?: number[],
	): Promise<Coupon> {
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
			servicesIds &&
			!coupon.services?.some((service) => servicesIds?.includes(service.id))
		) {
			throw new AppError("Cupom inválido", 400);
		}

		return coupon;
	}

	public async useCoupon(code: string, userId: number): Promise<void> {
		const coupon = await this.validateCoupon(code);
		await this.couponRepository.incrementUsage(coupon.id);
	}
}
