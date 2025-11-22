import type { IDashboardRepository } from "../../repositories/interfaces/IDashboardRepository";

export class DashboardService {
	constructor(private dashboardRepository: IDashboardRepository) {}

	async getDashboardData() {
		const mrr = await this.dashboardRepository.getMRR();
		const totalRevenue = await this.dashboardRepository.getTotalRevenue();
		const yearlyRevenueHistory =
			await this.dashboardRepository.getYearlyRevenueHistory();
		const topUsersByDailyWashes =
			await this.dashboardRepository.getTopUsersByDailyWashes();
		const topServicesSold = await this.dashboardRepository.getTopServicesSold();
		const topPlansSold = await this.dashboardRepository.getTopPlansSold();
		const washLocationsByDailyWashes =
			await this.dashboardRepository.orderWashLocationsByDailyWashes();

		return {
			mrr,
			totalRevenue,
			yearlyRevenueHistory,
			topUsersByDailyWashes,
			topServicesSold,
			topPlansSold,
			washLocationsByDailyWashes,
		};
	}
}
