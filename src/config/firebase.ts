import admin from "firebase-admin";
import fs from "fs";
import path from "path";

let firebaseAdmin: typeof admin | null = null;

try {
	// Ruta del archivo JSON
	const serviceAccountPath = path.resolve(__dirname, "./../../firebase.json");

	// Verifica si el archivo existe antes de intentar cargarlo
	if (fs.existsSync(serviceAccountPath)) {
		const serviceAccount = JSON.parse(
			fs.readFileSync(serviceAccountPath, "utf-8"),
		);

		// Inicializa Firebase Admin SDK
		if (!admin.apps.length) {
			admin.initializeApp({
				credential: admin.credential.cert(serviceAccount),
			});
		}
		console.log("Firebase Admin SDK initialized successfully.");
		firebaseAdmin = admin;
	} else {
		console.warn(
			`Service account file not found at path: ${serviceAccountPath}. Firebase features will be disabled.`,
		);
	}
} catch (error) {
	if (error instanceof Error) {
		console.error("Error initializing Firebase Admin SDK:", error.message);
	} else {
		console.error(
			"An unknown error occurred during Firebase initialization:",
			error,
		);
	}
}

export function getFirebaseAdmin(): typeof admin {
	if (!firebaseAdmin) {
		throw new Error(
			"Firebase Admin SDK is not initialized. Ensure the service account file is available.",
		);
	}
	return firebaseAdmin;
}
