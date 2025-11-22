import type { Coupon } from "../../entities/Coupon";
import type { CreateCouponDTO } from "../../modules/coupon/dto/CreateCouponDTO";
import type { UpdateCouponDTO } from "../../modules/coupon/dto/UpdateCouponDTO";

export interface CouponInclude {
	plans?: boolean;
	services?: boolean;
}

export interface ICouponRepository {
	create(data: CreateCouponDTO): Promise<Coupon>;
	findById(id: number, include?: CouponInclude): Promise<Coupon | null>;
	findByCode(
		code: string,
		planId?: number,
		serviceId?: number,
	): Promise<Coupon | null>;
	findAll(): Promise<Coupon[]>;
	update(id: number, data: UpdateCouponDTO): Promise<Coupon>;
	delete(id: number): Promise<void>;
	incrementUsage(id: number): Promise<void>;
	isCouponValid(coupon: Coupon): boolean;
	hasReachedUsageLimit(coupon: Coupon): boolean;
	isExpired(coupon: Coupon): boolean;
	isNotStarted(coupon: Coupon): boolean;
}
