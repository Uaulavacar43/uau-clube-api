import { z } from "zod";

export const FileUploadDTO = z.object({
	name: z.string({ required_error: 'O campo "name" é obrigatório' }),
	mimeType: z.string({ required_error: 'O campo "mimeType" é obrigatório' }),
	folder: z.string().optional(),
	type: z.enum(["user", "wash-service", "wash-location"], {
		required_error: 'O campo "type" é obrigatório',
		invalid_type_error:
			'O campo "type" deve ser um dos valores: "user", "wash-service", "wash-location"',
	}),
});

export type FileUploadDTO = z.infer<typeof FileUploadDTO>;
