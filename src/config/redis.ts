import { envConfig } from "./envConfig";

const redisConfig = {
	host: envConfig.REDIS_HOST,
	port: envConfig.REDIS_PORT,

	url(): string {
		return `redis://${this.host}:${this.port}`;
	},
};

export default redisConfig;
