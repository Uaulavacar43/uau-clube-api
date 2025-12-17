import { z } from "zod";

const normalizePlate = (value: string) =>
    (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export const AdminUpdateCarDTO = z.object({
    // vem do /cars/:id
    id: z.coerce.number().int().positive(),

    // opcional: corrigir placa
    licensePlate: z
        .string()
        .min(1)
        .transform(normalizePlate)
        .refine((v) => v.length === 7, "Placa deve ter 7 caracteres (sem hífen/espaço)")
        .refine(
            (v) =>
                /^[A-Z]{3}[0-9]{4}$/.test(v) || // AAA9999
                /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(v), // AAA9A99
            "Placa inválida (formato não reconhecido)",
        )
        .optional(),

    // opcional: ativar/desativar no dashboard
    isActive: z.boolean().optional(),

    // opcional: transferir carro para outro usuário (admin)
    userId: z.coerce.number().int().positive().optional(),
});

export type AdminUpdateCarDTO = z.infer<typeof AdminUpdateCarDTO>;
