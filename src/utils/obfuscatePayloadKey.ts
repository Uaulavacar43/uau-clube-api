export function obfuscatePayloadKey(payload: Record<string, unknown>) {
	if (!payload) return payload;
	return Object.keys(payload).reduce(
		(acc, key) => {
			if (typeof payload[key] === "object") {
				acc[key] = obfuscatePayloadKey(payload[key] as Record<string, unknown>);
			} else {
				acc[key] = key.toLowerCase() === "password" ? "***" : payload[key];
			}
			return acc;
		},
		{} as Record<string, unknown>,
	);
}
