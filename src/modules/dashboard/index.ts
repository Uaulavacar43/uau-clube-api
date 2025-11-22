import { PrismaDashboardRepository } from "../../repositories/implementations/PrismaDashboardRepository";
import { DashboardController } from "./DashboardController";
import { DashboardService } from "./DashboardService";

const dashboardRepository = new PrismaDashboardRepository();
const dashboardService = new DashboardService(dashboardRepository);
const dashboardController = new DashboardController(dashboardService);

export default dashboardController;
