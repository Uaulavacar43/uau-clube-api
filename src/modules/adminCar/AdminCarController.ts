import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { AdminCarService } from "./AdminCarService";
import type { AdminUpdateCarDTO } from "./dto/AdminUpdateCarDTO";

export class AdminCarController {
    constructor(private adminCarService: AdminCarService) {}

    private isPrivilegedRole(role?: string): boolean {
        return role === "ADMIN" || role === "MANAGER";
    }

    public async getCarByPlate(req: Request, res: Response, next: NextFunction) {
        try {
            const actor = req.user;
            if (!actor) throw new AppError("Você não tem permissão para isto", 403);
            if (!this.isPrivilegedRole(actor.role)) {
                throw new AppError("Você não tem permissão para isto", 403);
            }

            const plate = req.params.licensePlate;
            if (!plate) throw new AppError("Placa inválida", 400);

            // por padrão: inclui inativos, porque é o caso do painel de suporte/admin
            const includeInactive = (req.query.includeInactive as string) !== "false";

            const car = await this.adminCarService.getCarByPlate(plate, includeInactive);

            // opcional: devolver "isActive" pronto para o dashboard
            return res.status(200).customJson({
                ...car,
                isActive: true, // o service/repo vai devolver carro mesmo inativo; se quiser, derive no service via deletedAt
            });
        } catch (error) {
            next(error);
        }
    }

    public async updateCar(req: Request, res: Response, next: NextFunction) {
        try {
            const actor = req.user;
            if (!actor) throw new AppError("Você não tem permissão para isto", 403);
            if (!this.isPrivilegedRole(actor.role)) {
                throw new AppError("Você não tem permissão para isto", 403);
            }

            const data = res.locals as AdminUpdateCarDTO;
            const updated = await this.adminCarService.updateCar(data);

            return res.status(200).customJson(updated);
        } catch (error) {
            next(error);
        }
    }
}
