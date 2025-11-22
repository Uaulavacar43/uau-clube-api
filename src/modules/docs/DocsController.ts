import type { NextFunction, Request, Response } from "express";
import fs from "fs";
import { marked } from "marked";
import path from "path";

export class DocsController {
	private docsPath: string;

	constructor() {
		this.docsPath = path.join(".", "docs");
	}

	public async renderDocs(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const docFiles = await this.getDocFiles();
			const selectedDoc = req.params.docName || docFiles[0];
			const docContent = await this.getDocContent(selectedDoc);

			res.render("docs", {
				layout: "main",
				docFiles,
				selectedDoc,
				docContent: marked.parse(docContent),
				title: "UAU Clube API - Documentação",
			});
		} catch (error) {
			console.log("renderDocs", error);
			next(error);
		}
	}

	private async getDocFiles(): Promise<string[]> {
		return new Promise((resolve, reject) => {
			fs.readdir(this.docsPath, (err, files) => {
				if (err) {
					reject(err);
					return;
				}

				const markdownFiles = files.filter((file) => file.endsWith(".md"));
				resolve(markdownFiles);
			});
		});
	}

	private async getDocContent(fileName: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const filePath = path.join(this.docsPath, fileName);

			fs.readFile(filePath, "utf8", (err, data) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(data);
			});
		});
	}
}
