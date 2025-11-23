import { Router, type Request, type Response, type NextFunction } from "express";
import { AsaasSyncService } from "./AsaasSyncService";

const router: Router = Router();
const asaasService: AsaasSyncService = new AsaasSyncService();

router.get(
  "/clientes",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const offsetParam: string | undefined = req.query.offset as string | undefined;
      const limitParam: string | undefined = req.query.limit as string | undefined;

      const offset: number = offsetParam !== undefined ? Number(offsetParam) : 0;
      const limit: number = limitParam !== undefined ? Number(limitParam) : 10;

      const resultado = await asaasService.listarClientesDiretoAsaas(
        offset,
        limit,
      );

      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  },
);

router.get(
  "/pagamentos",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const offsetParam: string | undefined = req.query.offset as string | undefined;
      const limitParam: string | undefined = req.query.limit as string | undefined;

      const offset: number = offsetParam !== undefined ? Number(offsetParam) : 0;
      const limit: number = limitParam !== undefined ? Number(limitParam) : 10;

      const resultado = await asaasService.listarPagamentosDiretoAsaas(
        offset,
        limit,
      );

      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  },
);

router.post(
  "/sincronizar",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const resultado = await asaasService.sincronizarTudo();
      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  },
);

export default router;
