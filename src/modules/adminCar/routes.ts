// src/modules/adminCar/routes.ts
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { accessControlMiddleware } from "../../middlewares/AccessControlMiddleware";
import { AppError } from "../../error/AppError";

import { AdminCarController } from "./AdminCarController";
import { AdminCarService } from "./AdminCarService";

import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";

import { AdminUpdateCarDTO } from "./dto/AdminUpdateCarDTO";

// ---------------------------------------------------------------------
// Instâncias (singletons) — mesmo padrão do resto do projeto
// ---------------------------------------------------------------------
const userCarRepository = new PrismaUserCarRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();

const adminCarService = new AdminCarService(userCarRepository, subscriptionRepository);
const adminCarController = new AdminCarController(adminCarService);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const normalizePlate = (value: string) =>
    (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateParamsQuery<T extends z.ZodTypeAny>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        const merged = { ...req.params, ...req.query };
        const parsed = schema.safeParse(merged);

        if (!parsed.success) {
            return next(new AppError("Payload inválido", 400));
        }

        // mantém compatibilidade com controllers que leem req.params/req.query
        const data = parsed.data as Record<string, unknown>;

        if (typeof data.licensePlate === "string") {
            req.params.licensePlate = data.licensePlate;
        }
        if (typeof data.userId === "number") {
            (req.params as any).userId = String(data.userId);
        }
        if (typeof data.carId === "number") {
            (req.params as any).carId = String(data.carId);
        }
        if (data.includeInactive !== undefined) {
            (req.query as any).includeInactive = data.includeInactive;
        }

        // também deixa disponível em res.locals (caso algum controller use)
        res.locals = { ...(res.locals ?? {}), ...data };

        return next();
    };
}

// ---------------------------------------------------------------------
// Schemas (params/query)
// ---------------------------------------------------------------------
const GetCarByPlateSchema = z.object({
    licensePlate: z.string().min(1).transform(normalizePlate),
    includeInactive: z
        .preprocess((v) => String(v ?? "true").toLowerCase(), z.enum(["true", "false"]))
        .optional(),
});

const GetCarByPlateAndUserSchema = z.object({
    licensePlate: z.string().min(1).transform(normalizePlate),
    userId: z.coerce.number().int().positive(),
    includeInactive: z
        .preprocess((v) => String(v ?? "true").toLowerCase(), z.enum(["true", "false"]))
        .optional(),
});

const CarIdSchema = z.object({
    carId: z.coerce.number().int().positive(),
});

const ReactivateSchema = z.object({
    licensePlate: z.string().min(1).transform(normalizePlate),
    userId: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
const routes = Router();

// ✅ 1) autenticação antes (garante req.user)
routes.use(authMiddleware);

// ✅ 2) controle de acesso por role (ADMIN/MANAGER)
routes.use(accessControlMiddleware(["ADMIN", "MANAGER"]));

// GET /admin-car/plate/:licensePlate?includeInactive=true|false
routes.get(
    "/plate/:licensePlate",
    validateParamsQuery(GetCarByPlateSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.getCarByPlate(req, res, next);
    },
);

// GET /admin-car/plate/:licensePlate/user/:userId?includeInactive=true|false
routes.get(
    "/plate/:licensePlate/user/:userId",
    validateParamsQuery(GetCarByPlateAndUserSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.getCarByPlateAndUserId(req, res, next);
    },
);

// PATCH /admin-car/:carId/activate
routes.patch(
    "/:carId/activate",
    validateParamsQuery(CarIdSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.activateCar(req, res, next);
    },
);

// PATCH /admin-car/:carId/deactivate
routes.patch(
    "/:carId/deactivate",
    validateParamsQuery(CarIdSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.deactivateCar(req, res, next);
    },
);

// PATCH /admin-car/plate/:licensePlate/user/:userId/reactivate
routes.patch(
    "/plate/:licensePlate/user/:userId/reactivate",
    validateParamsQuery(ReactivateSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.reactivateCarByPlateAndUserId(req, res, next);
    },
);

// PUT /admin-car
// mantém teu padrão: controller lê res.locals como AdminUpdateCarDTO
routes.put(
    "/",
    validateRoutePayload(AdminUpdateCarDTO),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.updateCar(req, res, next);
    },
);

export default routes;
