declare module "express-serve-static-core" {
	interface Request {
		user?: {
			id: number;
			userId?: number;
			email: string;
			role: "ADMIN" | "USER" | "MANAGER";
		};
	}
}

export type PaymentStatus = PrismaPaymentStatus;

declare global {
	namespace Express {
		interface Response {
			customJson(...args: Parameters<Response["json"]>): Response;
		}
	}
}
