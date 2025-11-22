import { z } from "zod";

// Reaproveitando schema de horários existente
const OpeningHourSchema = z.object({
	dayOfWeek: z.enum(
		[
			"MONDAY",
			"TUESDAY",
			"WEDNESDAY",
			"THURSDAY",
			"FRIDAY",
			"SATURDAY",
			"SUNDAY",
			"HOLIDAY",
		],
		{
			required_error: "Day of week is required",
		},
	),
	openTime: z.string({
		required_error: "Open time is required",
	}),
	closeTime: z.string({
		required_error: "Close time is required",
	}),
});

// Schema para serviços disponíveis
const ServiceAvailabilitySchema = z.object({
	serviceId: z.number({
		required_error: "Service ID is required",
	}),
	isAvailable: z.boolean({
		required_error: "Availability status is required",
	}),
});

// Schema completo para cadastro
export const RegisterCompleteWashLocationDTO = z.object({
	// Dados básicos da localização
	name: z.string({ required_error: "Name is required" }),
	images: z
		.array(z.string())
		.nonempty({ message: "At least one image URL is required" }),
	street: z.string({ required_error: "Street is required" }),
	number: z.string({ required_error: "Number is required" }),
	neighborhood: z.string({ required_error: "Neighborhood is required" }),
	city: z.string({ required_error: "City is required" }),
	phoneNumber: z.string().optional(),
	managerId: z.number({ required_error: "Manager ID is required" }),
	flow: z.enum(["LOW", "MODERATE", "HIGH"]).default("LOW"),

	// Dados adicionais
	openingHours: z.array(OpeningHourSchema).optional(),
	services: z.array(ServiceAvailabilitySchema).optional(),
});

export type RegisterCompleteWashLocationDTO = z.infer<
	typeof RegisterCompleteWashLocationDTO
>;
