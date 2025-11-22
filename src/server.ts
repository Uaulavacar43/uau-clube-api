import app from "./app";
import { envConfig } from "./config/envConfig";

// Asegúrate de convertir el puerto a un número válido o usar un valor predeterminado.
const port = Number(envConfig.PORT) || 3000;

app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
