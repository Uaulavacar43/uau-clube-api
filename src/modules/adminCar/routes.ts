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

/**
 * @openapi
 * tags:
 *   - name: AdminCar
 *     description: Rotas administrativas para gestão de veículos de usuários
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: Payload inválido
 *         statusCode:
 *           type: number
 *           example: 400
 *
 *     AdminCar:
 *       type: object
 *       description: Representação genérica de um carro vinculado a um usuário (ajuste conforme teu model real)
 *       properties:
 *         id:
 *           type: integer
 *           example: 123
 *         userId:
 *           type: integer
 *           example: 45
 *         licensePlate:
 *           type: string
 *           example: ABC1D23
 *         isActive:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: 2026-01-01T10:00:00.000Z
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: 2026-01-02T12:30:00.000Z
 *
 *     AdminUpdateCarDTO:
 *       type: object
 *       description: Payload para atualização administrativa de veículo (ajuste para refletir o DTO real)
 *       additionalProperties: true
 *       properties:
 *         carId:
 *           type: integer
 *           example: 123
 *         userId:
 *           type: integer
 *           example: 45
 *         licensePlate:
 *           type: string
 *           example: ABC1D23
 *         brand:
 *           type: string
 *           example: Toyota
 *         model:
 *           type: string
 *           example: Corolla
 *         year:
 *           type: integer
 *           example: 2020
 *         color:
 *           type: string
 *           example: Prata
 */

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

/**
 * @openapi
 * /admin-car/plate/{licensePlate}:
 *   get:
 *     tags: [AdminCar]
 *     summary: Buscar carro por placa (admin)
 *     description: Retorna o carro vinculado à placa informada. A placa é normalizada (uppercase e sem caracteres especiais).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: licensePlate
 *         required: true
 *         schema:
 *           type: string
 *         description: Placa do veículo (ex. ABC1D23). Será normalizada no backend.
 *         example: ABC1D23
 *       - in: query
 *         name: includeInactive
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *           default: true
 *         description: "Se 'true', inclui carros inativos no resultado (quando aplicável)."
 *         example: "true"
 *     responses:
 *       200:
 *         description: Carro encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminCar'
 *       400:
 *         description: Payload inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (somente ADMIN/MANAGER)
 *       404:
 *         description: Carro não encontrado
 */
// GET /admin-car/plate/:licensePlate?includeInactive=true|false
routes.get(
    "/plate/:licensePlate",
    validateParamsQuery(GetCarByPlateSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.getCarByPlate(req, res, next);
    },
);

/**
 * @openapi
 * /admin-car/plate/{licensePlate}/user/{userId}:
 *   get:
 *     tags: [AdminCar]
 *     summary: Buscar carro por placa e usuário (admin)
 *     description: Retorna o carro da placa informada vinculado ao userId informado (útil quando existe histórico/mais de um vínculo).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: licensePlate
 *         required: true
 *         schema:
 *           type: string
 *         description: Placa do veículo (normalizada no backend)
 *         example: ABC1D23
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: ID do usuário dono do veículo
 *         example: 45
 *       - in: query
 *         name: includeInactive
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *           default: true
 *         description: "Se 'true', inclui carros inativos no resultado (quando aplicável)."
 *         example: "true"
 *     responses:
 *       200:
 *         description: Carro encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminCar'
 *       400:
 *         description: Payload inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (somente ADMIN/MANAGER)
 *       404:
 *         description: Carro não encontrado
 */
// GET /admin-car/plate/:licensePlate/user/:userId?includeInactive=true|false
routes.get(
    "/plate/:licensePlate/user/:userId",
    validateParamsQuery(GetCarByPlateAndUserSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.getCarByPlateAndUserId(req, res, next);
    },
);

/**
 * @openapi
 * /admin-car/{carId}/activate:
 *   patch:
 *     tags: [AdminCar]
 *     summary: Ativar carro por ID (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: carId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: ID do carro
 *         example: 123
 *     responses:
 *       200:
 *         description: Carro ativado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminCar'
 *       400:
 *         description: Payload inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (somente ADMIN/MANAGER)
 *       404:
 *         description: Carro não encontrado
 */
// PATCH /admin-car/:carId/activate
routes.patch(
    "/:carId/activate",
    validateParamsQuery(CarIdSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.activateCar(req, res, next);
    },
);

/**
 * @openapi
 * /admin-car/{carId}/deactivate:
 *   patch:
 *     tags: [AdminCar]
 *     summary: Desativar carro por ID (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: carId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: ID do carro
 *         example: 123
 *     responses:
 *       200:
 *         description: Carro desativado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminCar'
 *       400:
 *         description: Payload inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (somente ADMIN/MANAGER)
 *       404:
 *         description: Carro não encontrado
 */
// PATCH /admin-car/:carId/deactivate
routes.patch(
    "/:carId/deactivate",
    validateParamsQuery(CarIdSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.deactivateCar(req, res, next);
    },
);

/**
 * @openapi
 * /admin-car/plate/{licensePlate}/user/{userId}/reactivate:
 *   patch:
 *     tags: [AdminCar]
 *     summary: Reativar carro por placa e usuário (admin)
 *     description: Reativa um vínculo de carro que esteja inativo para uma placa + usuário específicos.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: licensePlate
 *         required: true
 *         schema:
 *           type: string
 *         description: Placa do veículo (normalizada no backend)
 *         example: ABC1D23
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: ID do usuário dono do veículo
 *         example: 45
 *     responses:
 *       200:
 *         description: Carro reativado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminCar'
 *       400:
 *         description: Payload inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (somente ADMIN/MANAGER)
 *       404:
 *         description: Carro não encontrado
 */
// PATCH /admin-car/plate/:licensePlate/user/:userId/reactivate
routes.patch(
    "/plate/:licensePlate/user/:userId/reactivate",
    validateParamsQuery(ReactivateSchema),
    (req: Request, res: Response, next: NextFunction) => {
        return adminCarController.reactivateCarByPlateAndUserId(req, res, next);
    },
);

/**
 * @openapi
 * /admin-car:
 *   put:
 *     tags: [AdminCar]
 *     summary: Atualizar carro (admin)
 *     description: Atualiza informações do carro via payload (validação feita por AdminUpdateCarDTO).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUpdateCarDTO'
 *           examples:
 *             exemplo:
 *               value:
 *                 carId: 123
 *                 userId: 45
 *                 licensePlate: "ABC1D23"
 *                 brand: "Toyota"
 *                 model: "Corolla"
 *                 year: 2020
 *                 color: "Prata"
 *     responses:
 *       200:
 *         description: Carro atualizado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminCar'
 *       400:
 *         description: Payload inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (somente ADMIN/MANAGER)
 *       404:
 *         description: Carro não encontrado
 */
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
