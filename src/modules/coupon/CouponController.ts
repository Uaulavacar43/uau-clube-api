import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { CouponService } from "./CouponService";
import type { CreateCouponDTO } from "./dto/CreateCouponDTO";
import type { UpdateCouponDTO } from "./dto/UpdateCouponDTO";
import type { ValidateCouponDTO } from "./dto/ValidateCouponDTO";

export class CouponController {
	constructor(private couponService: CouponService) {}

	public async createCoupon(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data: CreateCouponDTO = req.body;

			const coupon = await this.couponService.createCoupon(data);
			res.status(201).customJson(coupon);
		} catch (error) {
			next(error);
		}
	}

	public async listCoupons(
		_req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const coupons = await this.couponService.listCoupons();
			res.status(200).customJson(coupons);
		} catch (error) {
			next(error);
		}
	}

	public async getCouponById(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { id } = req.params;
			const coupon = await this.couponService.getCouponById(Number(id));
			res.status(200).customJson(coupon);
		} catch (error) {
			next(error);
		}
	}

	public async updateCoupon(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { id } = req.params;
			const data: UpdateCouponDTO = req.body;
			const coupon = await this.couponService.updateCoupon(Number(id), data);
			res.status(200).customJson(coupon);
		} catch (error) {
			next(error);
		}
	}

	public async deleteCoupon(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { id } = req.params;
			await this.couponService.deleteCoupon(Number(id));
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}

	public async validateCoupon(
		_req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const body = res.locals as ValidateCouponDTO;
			const coupon = await this.couponService.validateCoupon(
				body.code,
				body.planId,
				body.servicesIds,
			);
			console.log("coupon", coupon);
			res.status(200).customJson(coupon);
		} catch (error) {
			next(error);
		}
	}

	public async useCoupon(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { code } = req.params;
			const userId = req.user?.id;

			if (!userId) {
				throw new AppError("Usuário não autenticado", 401);
			}

			await this.couponService.useCoupon(code, userId);
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}
}
