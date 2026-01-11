import type { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { AppError } from "../error/AppError";

export const errorHandler = (
	err: Error,
	_req: Request,
	res: Response,
	_next: NextFunction,
): void => {
	// Log detalhado do erro para diagnóstico
	console.error("[ErrorHandler] Erro capturado:", {
		timestamp: new Date().toISOString(),
		message: err.message,
		stack: err.stack,
		name: err.name,
	});
	
	if (err instanceof AppError) {
		res.status(err.statusCode).customJson({ message: err.message });
		return;
	}
	if (err instanceof JsonWebTokenError) {
		res.status(401).customJson({ message: "Token inválido" });
		return;
	}
	if (err instanceof TokenExpiredError) {
		res.status(401).customJson({ message: "Token expirado" });
		return;
	}
	
	// Tratamento específico para erros do Prisma
	// Verifica se é erro do Prisma pelo nome ou mensagem
	const isPrismaError = 
		err.name === "PrismaClientKnownRequestError" ||
		err.name === "PrismaClientUnknownRequestError" ||
		err.name === "PrismaClientInitializationError" ||
		err.name === "PrismaClientRustPanicError" ||
		err.message.includes("prisma") || 
		err.message.includes("Prisma");
	
	if (isPrismaError) {
		// Log detalhado do erro do Prisma
		const prismaErrorDetails: any = {
			message: err.message,
			name: err.name,
			stack: err.stack,
		};
		
		// Adiciona informações específicas do Prisma se disponíveis (código de erro)
		const errorCode = (err as any).code;
		const errorMeta = (err as any).meta;
		
		if (errorCode) {
			prismaErrorDetails.code = errorCode;
			prismaErrorDetails.meta = errorMeta;
		}
		
		console.error("[ErrorHandler] Erro do Prisma detalhado:", prismaErrorDetails);
		
		// Tratamento específico por código de erro do Prisma
		if (errorCode) {
			// P1001 - Can't reach database server
			// P1002 - Database server doesn't accept connections
			// P1008 - Operations timed out
			// P1017 - Server has closed the connection
			if (["P1001", "P1002", "P1008", "P1017"].includes(errorCode)) {
				res.status(503).customJson({ 
					message: "Erro de conexão com o banco de dados. Tente novamente em alguns instantes.",
				});
				return;
			}
			
			// P1000 - Authentication failed
			if (errorCode === "P1000") {
				res.status(500).customJson({ 
					message: "Erro de autenticação com o banco de dados. Contate o suporte.",
				});
				return;
			}
			
			// P1003 - Database does not exist
			if (errorCode === "P1003") {
				res.status(500).customJson({ 
					message: "Banco de dados não encontrado. Contate o suporte.",
				});
				return;
			}
		}
		
		// Verifica se é erro de conexão pela mensagem
		if (err.message.includes("connect") || err.message.includes("connection") || err.message.includes("timeout") || err.message.includes("ECONNREFUSED") || err.message.includes("ENOTFOUND")) {
			res.status(503).customJson({ 
				message: "Erro de conexão com o banco de dados. Tente novamente em alguns instantes.",
			});
			return;
		}
		
		// Verifica se é erro de autenticação do banco
		if (err.message.includes("authentication") || err.message.includes("password")) {
			res.status(500).customJson({ 
				message: "Erro de configuração do banco de dados. Contate o suporte.",
			});
			return;
		}
		
		// Outros erros do Prisma - mostra código se disponível
		const errorMessage = errorCode 
			? `Erro no banco de dados (${errorCode}). Contate o suporte.`
			: "Erro ao processar requisição no banco de dados";
		
		res.status(500).customJson({ 
			message: errorMessage,
		});
		return;
	}
	
	res.status(500).customJson({ message: "Erro interno do servidor" });
};
