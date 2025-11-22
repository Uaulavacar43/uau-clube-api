import type { NextFunction, Request, Response } from "express";
import path from "path";
import slugify from "slugify";
import { createPresignedUrl } from "../../utils/s3";
import type { FileUploadDTO } from "./dto/FileUploadDTO";

export class FileUploadController {
	public async generateFileUrl(
		_req: Request,
		res: Response,
		next: NextFunction,
	) {
		const { name, mimeType, folder, type } = res.locals as FileUploadDTO;

		try {
			const urls = await createPresignedUrl({
				folder: path.posix.join(type, folder || ""),
				fileName: slugify(name, { lower: true, trim: true }),
				contentType: mimeType,
			});

			res.customJson(urls);
		} catch (error) {
			next(error);
		}
	}
}
