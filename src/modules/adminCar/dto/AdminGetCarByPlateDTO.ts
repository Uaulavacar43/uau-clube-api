import { z } from "zod";

const normalizePlate = (value: string) =>
    (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export const AdminGetCarByPlateDTO = z.object({
    licensePlate: z.string().min(1).transform(normalizePlate),
    includeInactive: z
        .preprocess((v) => String(v ?? "").toLowerCase(), z.enum(["true", "false"]))
        .optional(),
});

export type AdminGetCarByPlateDTO = z.infer<typeof AdminGetCarByPlateDTO>;
