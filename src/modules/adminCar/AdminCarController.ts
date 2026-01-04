import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { AdminCarService } from "./AdminCarService";
import type { AdminUpdateCarDTO } from "./dto/AdminUpdateCarDTO";
import type { AdminGetCarByPlateDTO } from "./dto/AdminGetCarByPlateDTO";

export class AdminCarController {
    constructor(private readonly adminCarService: AdminCarService) {}

    private isPrivilegedRole(role?: string): boolean {
        return role === "ADMIN" || role === "MANAGER";
    }

    private assertPrivileged(req: Request, next: NextFunction): boolean {
        const actor = req.user as any;
        if (!actor) {
            next(new AppError("Você não tem permissão para isto", 403));
            return false;
        }
        if (!this.isPrivilegedRole(actor.role)) {
            next(new AppError("Você não tem permissão para isto", 403));
            return false;
        }
        return true;
    }

    public async getCarByPlate(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.assertPrivileged(req, next)) return;

        try {
            // se tu usa middleware zod que coloca em res.locals, use isso:
            const data = res.locals as AdminGetCarByPlateDTO | undefined;

            const plateRaw =
                (data as any)?.licensePlate ??
                req.params.licensePlate;

            if (!plateRaw) {
                return next(new AppError("Placa inválida", 400));
            }

            const includeInactiveRaw =
                (data as any)?.includeInactive ??
                (req.query.includeInactive as string | undefined);

            const includeInactive = String(includeInactiveRaw ?? "true").toLowerCase() !== "false";

            const car = await this.adminCarService.getCarByPlate(plateRaw, includeInactive);
            res.status(200).customJson(car);
        } catch (error) {
            next(error);
        }
    }

    public async getCarByPlateAndUserId(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.assertPrivileged(req, next)) return;

        try {
            const plate = req.params.licensePlate;
            const userIdRaw = req.params.userId ?? (req.query.userId as any);

            if (!plate) {
                return next(new AppError("Placa inválida", 400));
            }

            const userId = Number(userIdRaw);
            if (!Number.isFinite(userId) || userId <= 0) {
                return next(new AppError("userId inválido", 400));
            }

            const includeInactive = String(req.query.includeInactive ?? "true").toLowerCase() !== "false";

            const car = await this.adminCarService.getCarByPlateAndUserId(
                plate,
                userId,
                includeInactive,
            );

            res.status(200).customJson(car);
        } catch (error) {
            next(error);
        }
    }

    public async activateCar(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.assertPrivileged(req, next)) return;

        try {
            const carId = Number(req.params.carId);
            if (!Number.isFinite(carId) || carId <= 0) {
                return next(new AppError("carId inválido", 400));
            }

            const updated = await this.adminCarService.activateCar(carId);
            res.status(200).customJson(updated);
        } catch (error) {
            next(error);
        }
    }

    public async deactivateCar(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.assertPrivileged(req, next)) return;

        try {
            const carId = Number(req.params.carId);
            if (!Number.isFinite(carId) || carId <= 0) {
                return next(new AppError("carId inválido", 400));
            }

            const updated = await this.adminCarService.deactivateCar(carId);
            res.status(200).customJson(updated);
        } catch (error) {
            next(error);
        }
    }

    public async reactivateCarByPlateAndUserId(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.assertPrivileged(req, next)) return;

        try {
            const plate = req.params.licensePlate;
            const userId = Number(req.params.userId);

            if (!plate) {
                return next(new AppError("Placa inválida", 400));
            }
            if (!Number.isFinite(userId) || userId <= 0) {
                return next(new AppError("userId inválido", 400));
            }

            const updated = await this.adminCarService.reactivateCarByPlateAndUserId(plate, userId);
            res.status(200).customJson(updated);
        } catch (error) {
            next(error);
        }
    }

    public async updateCar(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.assertPrivileged(req, next)) return;

        try {
            const data = res.locals as AdminUpdateCarDTO;
            const updated = await this.adminCarService.updateCar(data);
            res.status(200).customJson(updated);
        } catch (error) {
            next(error);
        }
    }
}
