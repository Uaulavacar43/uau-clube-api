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

// Schema completo para atualização
export const UpdateCompleteWashLocationDTO = z.object({
	// Dados básicos da localização (todos opcionais)
	managerId: z.coerce.number().optional(),
	name: z.string().optional(),
	images: z.array(z.string()).optional(),
	street: z.string().optional(),
	number: z.string().optional(),
	neighborhood: z.string().optional(),
	city: z.string().optional(),
	phoneNumber: z.string().optional(),
	flow: z.enum(["LOW", "MODERATE", "HIGH"]).optional(),
	isActive: z.boolean().optional(),

	// Dados adicionais
	openingHours: z.array(OpeningHourSchema).optional(),
	services: z.array(ServiceAvailabilitySchema).optional(),
});

export type UpdateCompleteWashLocationDTO = z.infer<
	typeof UpdateCompleteWashLocationDTO
>;
