import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { RequestLogQueue } from "../queues/RequestLogQueue";
import { ResponseLogQueue } from "../queues/ResponseLogQueue";
import { obfuscatePayloadKey } from "../utils/obfuscatePayloadKey";
import { decodeToken } from "../utils/token";

export function requestLogMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	let userId: number | undefined;
	if (req.headers.authorization) {
		const decodedToken = decodeToken<{ userId: number }>(
			req.headers.authorization,
		);
		userId = decodedToken?.userId;
	}

	const requestId = randomUUID();

	const requestLogQueue = new RequestLogQueue();
	requestLogQueue.addToQueue({
		requestId,
		userId,
		method: req.method,
		path: req.path,
		query: req.query,
		body: req.body ? obfuscatePayloadKey(req.body) : {},
		params: req.params,
		ip: req.ip,
		userAgent: req.get("user-agent"),
	});

	res.customJson = (...args: Parameters<typeof res.json>) => {
		const responseLogQueue = new ResponseLogQueue();
		responseLogQueue.addToQueue({
			requestId,
			status: `${res.statusCode}`,
			data: args,
			ip: req.ip,
			userAgent: req.get("user-agent"),
		});

		return res.json(...args);
	};

	next();
}
