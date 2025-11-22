import type { Express } from "express";
import { engine } from "express-handlebars";
import path from "path";

export function configureHandlebars(app: Express): void {
	app.engine(
		"handlebars",
		engine({
			defaultLayout: "main",
			layoutsDir: path.join(".", "views", "layouts"),
			partialsDir: path.join(".", "views", "partials"),
			helpers: {
				eq: (a: any, b: any) => a === b,
				formatDocName: (filename: string) => {
					// Remove a extensão .md e substitui hífens por espaços
					const name = filename.replace(".md", "").replace(/-/g, " ");
					// Capitaliza cada palavra
					return name
						.split(" ")
						.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
						.join(" ");
				},
				formatDate: () =>
					new Date().toLocaleDateString("pt-BR", {
						day: "2-digit",
						month: "2-digit",
						year: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					}),
			},
		}),
	);

	app.set("view engine", "handlebars");
	app.set("views", path.join(".", "views"));
}
