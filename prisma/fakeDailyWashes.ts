import { faker } from "@faker-js/faker";
import { type DailyWash, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function createFakeDailyWashes() {
	console.log("Starting to create fake daily washes...");

	// Get all cars and wash locations to distribute washes among them
	const cars = await prisma.car.findMany({ where: { deletedAt: null } });
	const washLocations = await prisma.washLocation.findMany();

	if (cars.length === 0) {
		throw new Error(
			"No cars found in database. Please add cars before generating fake daily washes.",
		);
	}

	if (washLocations.length === 0) {
		throw new Error(
			"No wash locations found in database. Please add wash locations before generating fake daily washes.",
		);
	}

	// Calculate date 3 months ago from now
	const threeMonthsAgo = new Date();
	threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

	const fakeDailyWashes: Omit<DailyWash, "id">[] = [];

	// Generate 200 fake daily washes
	for (let i = 0; i < 20000; i++) {
		const carIds = cars.map((c) => c.id);
		const randomCar = carIds[Math.floor(Math.random() * carIds.length)];
		const washLocationIds = washLocations.map((wl) => wl.id);
		const randomWashLocation =
			washLocationIds[Math.floor(Math.random() * washLocationIds.length)];

		// Random date between 3 months ago and now
		const washDate = faker.date.between({
			from: threeMonthsAgo,
			to: new Date(),
		});

		fakeDailyWashes.push({
			carId: randomCar,
			washLocationId: randomWashLocation,
			washDate: washDate,
			createdAt: washDate,
			updatedAt: washDate,
		});

		console.log(`Created fake daily wash ${i + 1}`);
	}

	// Insert all fake daily washes
	const result = await prisma.dailyWash.createMany({
		data: fakeDailyWashes,
		skipDuplicates: true,
	});

	console.log(`Successfully created ${result.count} fake daily washes`);
}

// Execute the function
createFakeDailyWashes()
	.catch((e) => {
		console.error("Error creating fake daily washes:", e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
