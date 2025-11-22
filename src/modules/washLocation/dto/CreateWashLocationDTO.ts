import { z } from "zod";

const ServiceDTO = z.object({
	id: z.number({ required_error: "Service ID is required" }),
	isAvailable: z.boolean().optional(), // Disponibilidad opcional de cada servicio
});

export const CreateWashLocationDTO = z.object({
	name: z.string({ required_error: "Name is required" }),
	imageUrl: z.string({ required_error: "Image URL is required" }),
	street: z.string({ required_error: "Street is required" }),
	number: z.string({ required_error: "Number is required" }),
	neighborhood: z.string({ required_error: "Neighborhood is required" }),
	city: z.string({ required_error: "City is required" }),
	managerId: z.number({ required_error: "Manager ID is required" }),
	services: z.array(ServiceDTO).optional(), // Agregamos la lista opcional de servicios
});

export type CreateWashLocationDTO = z.infer<typeof CreateWashLocationDTO>;
