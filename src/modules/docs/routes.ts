import { Router } from "express";
import { DocsController } from "./DocsController";

const router = Router();
const docsController = new DocsController();

// Rota principal da documentação
router.get("/", (req, res, next) => docsController.renderDocs(req, res, next));

// Rota para visualizar uma documentação específica
router.get("/:docName", (req, res, next) =>
	docsController.renderDocs(req, res, next),
);

export default router;
