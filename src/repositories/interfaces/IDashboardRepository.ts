export type ListData<T> = {
	total: number;
	data: T[];
};

export type TopUser = {
	user: {
		id: number;
		name: string;
		email: string;
		phone: string;
	};
	dailyWashesCount: number;
};

export type TopWashService = {
	service: {
		id: number;
		name: string;
		price: number;
		imageUrl: string;
		isAvailable: boolean;
	};
	purchaseCount: number;
};

export type TopPlan = {
	plan: {
		id: number;
		name: string;
		description?: string | null;
		price: number;
		duration: number;
		isBestChoice: boolean;
		periodicityType: string;
	};
	subscriptionCount: number;
};

export type WashLocationsByDailyWashes = {
	location: {
		id: number;
		name: string;
		images: string[];
		street: string;
		number: string;
		neighborhood: string;
		city: string;
	};
	dailyWashesCount: number;
	dailyWashesByDate: Array<{
		date: string;
		count: number;
	}>;
};

export interface IDashboardRepository {
	getMRR(): Promise<number>;
	getTotalRevenue(): Promise<number>;
	getCurrentMonthRevenue(): Promise<number>;
	getYearlyRevenueHistory(): Promise<{ year: number; total: number }[]>;
	getTopUsersByDailyWashes(): Promise<ListData<TopUser>>;
	getTopServicesSold(): Promise<ListData<TopWashService>>;
	getTopPlansSold(): Promise<ListData<TopPlan>>;
	orderWashLocationsByDailyWashes(): Promise<
		ListData<WashLocationsByDailyWashes>
	>;
}
