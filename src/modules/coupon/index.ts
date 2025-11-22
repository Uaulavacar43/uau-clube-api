import { PrismaCouponRepository } from "../../repositories/implementations/PrismaCouponRepository";
import { CouponController } from "./CouponController";
import { CouponService } from "./CouponService";

const couponRepository = new PrismaCouponRepository();
const couponService = new CouponService(couponRepository);
export const couponController = new CouponController(couponService);
